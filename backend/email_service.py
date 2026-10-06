"""Transactional email: sign-in credentials, password resets and test messages.

Providers (EMAIL_PROVIDER = auto | brevo | resend | smtp | none; auto picks the
first configured of brevo -> resend -> smtp):
  * Brevo  — BREVO_API_KEY, HTTPS API. Recommended: the free plan sends 300
             emails/day from a verified single sender address, no domain needed.
  * Resend — RESEND_API_KEY, HTTPS API (needs a verified sending domain).
  * SMTP   — SMTP_HOST, SMTP_PORT (587, or 465 with SMTP_SSL=true), SMTP_USER,
             SMTP_PASSWORD. Render's free instances block outbound SMTP ports,
             so prefer an HTTP provider there.
EMAIL_FROM (the sender address) is required; EMAIL_FROM_NAME defaults to
"UniStream Saver". Configuration is read at call time, so the admin panel
reflects the current environment and tests can patch os.environ.

Every interpolated value is HTML-escaped; links are restricted to http(s).
"""

import html
import logging
import os
import re
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv

import security


backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

logger = logging.getLogger(__name__)

BRAND = "UniStream Saver"
DEFAULT_FROM_NAME = BRAND
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 15.0
PROVIDERS = ("brevo", "resend", "smtp")
PROVIDER_LABELS = {"brevo": "Brevo", "resend": "Resend", "smtp": "SMTP"}
_PROVIDER_KEYS = {"brevo": "BREVO_API_KEY", "resend": "RESEND_API_KEY", "smtp": "SMTP_HOST"}
_TRUE = {"1", "true", "yes", "on"}
_ADDRESS_RE = re.compile(r"[^@\s<>,;:\"'()\[\]\\]+@[^@\s<>,;:\"'()\[\]\\]+\.[^@\s<>,;:\"'()\[\]\\]+")


class EmailError(RuntimeError):
    """Sending failed; the message is short and safe to show to the admin."""


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def app_url() -> str:
    """Public frontend origin used in email links (FRONTEND_URL, no trailing slash)."""
    raw = _env("FRONTEND_URL").split(",")[0].strip().rstrip("/")
    if not raw:
        return "http://localhost:3000"
    # Hosting dashboards often get "myapp.vercel.app" pasted without a scheme.
    return raw if re.match(r"^https?://", raw, re.I) else f"https://{raw}"


# ── Configuration ─────────────────────────────────────────────────────────────

def _sender() -> tuple[str | None, str]:
    """(from_email, from_name). Tolerates EMAIL_FROM="Name <addr@example.com>"."""
    parsed_name, address = parseaddr(_env("EMAIL_FROM"))
    name = " ".join((_env("EMAIL_FROM_NAME") or parsed_name or DEFAULT_FROM_NAME).split())
    name = re.sub(r"[\"<>\\,;]", "", name) or DEFAULT_FROM_NAME
    return (address.strip().lower() or None), name


def _resolve_provider() -> tuple[str | None, str | None]:
    """(provider, issue). issue is None when email can be sent."""
    choice = _env("EMAIL_PROVIDER", "auto").lower() or "auto"
    if choice == "none":
        return None, "Email sending is turned off (EMAIL_PROVIDER=none)."
    if choice not in {"auto", *PROVIDERS}:
        return None, "EMAIL_PROVIDER must be one of: auto, brevo, resend, smtp, none."
    if choice == "auto":
        provider = next((p for p in PROVIDERS if _env(_PROVIDER_KEYS[p])), None)
        if provider is None:
            return None, (
                "No email provider is set up. Add BREVO_API_KEY (recommended), "
                "RESEND_API_KEY or SMTP_HOST."
            )
    else:
        provider = choice
        if not _env(_PROVIDER_KEYS[provider]):
            return provider, f"{_PROVIDER_KEYS[provider]} is not set."

    if provider == "smtp":
        if _env("SMTP_PORT") and not _env("SMTP_PORT").isdigit():
            return provider, "SMTP_PORT must be a number."
        if _env("SMTP_USER") and not os.getenv("SMTP_PASSWORD", ""):
            return provider, "SMTP_PASSWORD is not set."

    from_email, _ = _sender()
    if not from_email:
        return provider, "EMAIL_FROM (the sender address) is not set."
    if not _ADDRESS_RE.fullmatch(from_email):
        return provider, "EMAIL_FROM is not a valid email address."
    return provider, None


def email_status() -> dict:
    """{"configured", "provider", "from_email", "from_name", "issue"} for the admin panel.

    `issue` is a one-line explanation of what is missing (None when configured).
    """
    provider, issue = _resolve_provider()
    from_email, from_name = _sender()
    return {
        "configured": provider is not None and issue is None,
        "provider": provider,
        "from_email": from_email,
        "from_name": from_name,
        "issue": issue,
    }


# ── Sending ───────────────────────────────────────────────────────────────────

def _mask(address: str) -> str:
    """"student@gmail.com" -> "st***@gmail.com" so logs do not collect addresses."""
    local, _, domain = address.partition("@")
    return f"{local[:2]}***@{domain}"


def _clean_recipient(to) -> str:
    address = str(to or "").strip()
    if len(address) > 254 or not _ADDRESS_RE.fullmatch(address):
        raise EmailError("The recipient email address is not valid.")
    return address


def send_email(to: str, subject: str, html: str, text: str) -> None:
    """Send one message; raises EmailError with an admin-readable reason."""
    provider, issue = _resolve_provider()
    if provider is None or issue:
        raise EmailError(f"Email is not configured: {issue}")
    recipient = _clean_recipient(to)
    subject = " ".join(str(subject).split())  # no CR/LF: header injection
    from_email, from_name = _sender()
    send = {"brevo": _send_brevo, "resend": _send_resend, "smtp": _send_smtp}[provider]
    try:
        send(from_email, from_name, recipient, subject, html, text)
    except EmailError as exc:
        logger.warning("Email to %s via %s failed: %s", _mask(recipient), provider, exc)
        raise
    logger.info("Email sent to %s via %s", _mask(recipient), provider)


def _post(label: str, url: str, headers: dict, payload: dict) -> httpx.Response:
    try:
        return httpx.post(url, headers=headers, json=payload, timeout=TIMEOUT_SECONDS)
    except httpx.TimeoutException:
        raise EmailError(
            f"{label} did not respond within {int(TIMEOUT_SECONDS)} seconds. Try again."
        ) from None
    except httpx.HTTPError as exc:
        raise EmailError(f"Could not reach {label} ({type(exc).__name__}).") from None


def _http_failure(label: str, response: httpx.Response, key_env: str, secret: str) -> EmailError:
    detail = ""
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        detail = body.get("message") or body.get("error") or body.get("name") or ""
    detail = " ".join(str(detail).split())
    if secret:
        detail = detail.replace(secret, "***")
    detail = detail[:200]
    status = response.status_code
    if status == 401:
        return EmailError(f"{label} rejected the API key (HTTP 401). Check {key_env}.")
    if status == 429:
        return EmailError(
            f"{label} rate limit or daily quota reached (HTTP 429). Try again later."
        )
    suffix = f": {detail}" if detail else ""
    return EmailError(f"{label} rejected the email (HTTP {status}){suffix}")


def _send_brevo(from_email, from_name, to, subject, html_body, text_body) -> None:
    key = _env("BREVO_API_KEY")
    response = _post(
        "Brevo",
        BREVO_URL,
        {"api-key": key, "accept": "application/json", "content-type": "application/json"},
        {
            "sender": {"name": from_name, "email": from_email},
            "to": [{"email": to}],
            "subject": subject,
            "htmlContent": html_body,
            "textContent": text_body,
        },
    )
    if response.status_code not in (200, 201, 202):
        raise _http_failure("Brevo", response, "BREVO_API_KEY", key)


def _send_resend(from_email, from_name, to, subject, html_body, text_body) -> None:
    key = _env("RESEND_API_KEY")
    response = _post(
        "Resend",
        RESEND_URL,
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        {
            "from": f"{from_name} <{from_email}>",
            "to": [to],
            "subject": subject,
            "html": html_body,
            "text": text_body,
        },
    )
    if response.status_code not in (200, 201, 202):
        raise _http_failure("Resend", response, "RESEND_API_KEY", key)


def _send_smtp(from_email, from_name, to, subject, html_body, text_body) -> None:
    host = _env("SMTP_HOST")
    ssl_flag = _env("SMTP_SSL").lower()
    port = int(_env("SMTP_PORT") or (465 if ssl_flag in _TRUE else 587))
    # Port 465 is implicit TLS; STARTTLS there would hang until the timeout.
    use_ssl = ssl_flag in _TRUE or (not ssl_flag and port == 465)
    user = _env("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD", "")

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = formatdate(usegmt=True)
    message["Message-ID"] = make_msgid(domain=from_email.rpartition("@")[2])
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    context = ssl.create_default_context()
    where = f"{host}:{port}"
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS, context=context) as server:
                if user:
                    server.login(user, password)
                server.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS) as server:
                server.ehlo()
                # Always encrypt: credentials and temporary passwords must not
                # cross the network in clear text.
                server.starttls(context=context)
                server.ehlo()
                if user:
                    server.login(user, password)
                server.send_message(message)
    except smtplib.SMTPAuthenticationError:
        raise EmailError(
            "The SMTP server rejected SMTP_USER / SMTP_PASSWORD "
            "(Gmail needs an app password)."
        ) from None
    except smtplib.SMTPNotSupportedError:
        raise EmailError(
            f"{where} does not support STARTTLS. Use port 465 with SMTP_SSL=true."
        ) from None
    except smtplib.SMTPRecipientsRefused:
        raise EmailError("The mail server refused the recipient address.") from None
    except smtplib.SMTPSenderRefused:
        raise EmailError("The mail server refused the sender address (EMAIL_FROM).") from None
    except smtplib.SMTPException as exc:
        raise EmailError(f"SMTP error from {where}: {_short(exc)}") from None
    except TimeoutError:
        raise EmailError(
            f"Timed out connecting to {where}. Render free instances block SMTP "
            "ports; use Brevo (HTTP API) instead."
        ) from None
    except ssl.SSLError:
        raise EmailError(f"Secure (TLS) connection to {where} failed.") from None
    except OSError as exc:
        raise EmailError(
            f"Could not connect to {where} ({exc.strerror or type(exc).__name__})."
        ) from None


def _short(exc: Exception) -> str:
    text = " ".join(str(exc).split()) or type(exc).__name__
    return text[:160]


# ── Templates ─────────────────────────────────────────────────────────────────
# Table layout with inline styles: Gmail, Outlook and phone mail apps ignore
# most <style> rules. Light colours are declared explicitly so dark-mode
# clients keep the card readable.

_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
_MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace"
_INDIGO = "#4f46e5"
_INK = "#111827"
_TEXT = "#374151"
_MUTED = "#6b7280"


def _one_line(value) -> str:
    return " ".join(str(value if value is not None else "").split())


def _e(value) -> str:
    """Escape for HTML text and attribute values."""
    return html.escape(_one_line(value), quote=True)


def _safe_url(url, fallback: str) -> str:
    """Only absolute http(s) links: a javascript: href must never reach an inbox."""
    candidate = str(url or "").strip()
    try:
        parts = urlsplit(candidate)
    except ValueError:
        return fallback
    if (
        parts.scheme.lower() in {"http", "https"}
        and parts.netloc
        and not any(ch.isspace() or ord(ch) < 32 for ch in candidate)
    ):
        return candidate
    return fallback


def _timezone_label() -> str:
    name = security.app_timezone_name()
    return "Bangladesh time" if name == "Asia/Dhaka" else name


def _limit_text(daily_limit) -> str:
    if daily_limit is None or (isinstance(daily_limit, int) and daily_limit < 0):
        return "Unlimited downloads"
    if daily_limit == 0:
        return "Downloads are paused for your account"
    noun = "video" if daily_limit == 1 else "videos"
    return f"{daily_limit} {noun} per day, resets at midnight ({_timezone_label()})"


def _paragraph(inner_html: str, *, size: int = 16, color: str = _TEXT, margin: str = "0 0 16px") -> str:
    return (
        f'<p style="margin:{margin};font-family:{_FONT};font-size:{size}px;'
        f'line-height:1.6;color:{color};">{inner_html}</p>'
    )


def _button(url: str, label: str) -> str:
    href = _e(url)
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'class="btn" style="margin:8px 0 24px;">'
        f'<tr><td align="center" bgcolor="{_INDIGO}" style="border-radius:10px;background-color:{_INDIGO};">'
        f'<a href="{href}" target="_blank" rel="noopener" style="display:inline-block;'
        f'padding:14px 32px;font-family:{_FONT};font-size:16px;font-weight:600;line-height:1.2;'
        f'color:#ffffff;text-decoration:none;border-radius:10px;">{_e(label)}</a>'
        "</td></tr></table>"
    )


def _link_fallback(url: str) -> str:
    href = _e(url)
    return _paragraph(
        "Button not working? Copy and paste this link into your browser:<br>"
        f'<a href="{href}" target="_blank" rel="noopener" style="color:{_INDIGO};'
        f'word-break:break-all;">{href}</a>',
        size=13,
        color=_MUTED,
    )


def _details(rows: list[tuple[str, str]]) -> str:
    cells = "".join(
        "<tr>"
        f'<td style="padding:10px 16px;font-family:{_FONT};font-size:13px;color:{_MUTED};'
        f'white-space:nowrap;vertical-align:top;width:1%;">{_e(label)}</td>'
        f'<td style="padding:10px 16px 10px 0;font-family:{_FONT};font-size:15px;'
        f'font-weight:600;color:{_INK};word-break:break-word;">{_e(value)}</td>'
        "</tr>"
        for label, value in rows
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:0 0 20px;background-color:#f8fafc;border:1px solid #e5e7eb;'
        f'border-radius:12px;">{cells}</table>'
    )


def _password_box(password: str) -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:0 0 8px;"><tr>'
        '<td align="center" style="padding:18px 12px;background-color:#eef2ff;'
        'border:1px dashed #a5b4fc;border-radius:12px;">'
        f'<div style="font-family:{_FONT};font-size:12px;font-weight:600;letter-spacing:1px;'
        'text-transform:uppercase;color:#4338ca;">Temporary password</div>'
        f'<div style="padding-top:6px;font-family:{_MONO};font-size:24px;font-weight:700;'
        f'letter-spacing:2px;color:{_INK};word-break:break-all;">{_e(password)}</div>'
        "</td></tr></table>"
    )


def _callout(inner_html: str) -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:0 0 20px;"><tr>'
        '<td style="padding:14px 16px;background-color:#fffbeb;border:1px solid #fde68a;'
        f'border-radius:12px;font-family:{_FONT};font-size:14px;line-height:1.6;color:#92400e;">'
        f"{inner_html}</td></tr></table>"
    )


def _layout(*, title: str, preheader: str, heading: str, body: str, footer: str) -> str:
    # The run of invisible characters after the preheader stops inbox previews
    # from pulling body text in after it.
    filler = "&#8199;&#65279;&#847; " * 40
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{_e(title)}</title>
<style>
  @media only screen and (max-width: 600px) {{
    .outer {{ padding: 16px 8px !important; }}
    .card {{ padding: 24px 20px !important; }}
    .btn, .btn td, .btn a {{ display: block !important; width: 100% !important; box-sizing: border-box; text-align: center !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f3f9;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">{_e(preheader)}{filler}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f3f9;">
<tr><td align="center" class="outer" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:18px 32px;background-color:#4338ca;background-image:linear-gradient(135deg,#4f46e5,#0284c7);border-radius:16px 16px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="34" height="34" align="center" valign="middle" style="width:34px;height:34px;background-color:#ffffff;border-radius:9px;font-family:Arial,sans-serif;font-size:15px;line-height:34px;color:{_INDIGO};">&#9658;</td>
<td style="padding-left:12px;font-family:{_FONT};font-size:18px;font-weight:700;letter-spacing:0.2px;color:#ffffff;">{BRAND}</td>
</tr></table>
</td></tr>
<tr><td class="card" style="padding:32px;background-color:#ffffff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;">
<h1 style="margin:0 0 16px;font-family:{_FONT};font-size:22px;line-height:1.3;font-weight:700;color:{_INK};">{_e(heading)}</h1>
{body}
</td></tr>
<tr><td style="padding:20px 24px 0;font-family:{_FONT};font-size:12px;line-height:1.6;color:{_MUTED};text-align:center;">
{footer}<br>
&copy; {BRAND} &middot; Download videos from YouTube, Facebook and Instagram for personal study.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _greeting(name) -> str:
    clean = _one_line(name)
    return f"Hi {clean}," if clean else "Hi there,"


def build_credentials_email(
    *,
    to: str,
    name: str,
    login: str,
    password: str,
    daily_limit: int | None,
    login_url: str,
    phone: str | None = None,
    new_password: bool = False,
) -> tuple[str, str, str]:
    """(subject, html, text) for the "your account is ready" email.

    `daily_limit` is the effective limit: None or -1 means unlimited.
    `new_password=True` words it as a replacement password for an existing account.
    """
    base = app_url()
    sign_in_url = _safe_url(login_url, base + "/")
    account_url = base + "/account"
    login = _one_line(login)
    phone = _one_line(phone) if phone else ""
    limit = _limit_text(daily_limit)

    rows: list[tuple[str, str]] = []
    rows.append(("Email" if "@" in login else "Sign in with", login))
    if phone and phone != login:
        rows.append(("Phone", phone))
    rows.append(("Daily limit", limit))
    either = "your email or phone number" if phone and phone != login else "the login above"

    if new_password:
        subject = f"Your new {BRAND} password"
        heading = "Your new temporary password"
        preheader = "An administrator issued you a new temporary password."
        intro = (
            "An administrator has issued a new temporary password for your "
            f"{BRAND} account. Your previous password no longer works."
        )
    else:
        subject = f"Your {BRAND} account is ready"
        heading = "Your account is ready"
        preheader = "Your account was approved. Here's how to sign in."
        intro = (
            f"Good news — your {BRAND} account has been approved and is ready "
            "to use. Sign in with the details below."
        )

    body = "".join((
        _paragraph(_e(_greeting(name))),
        _paragraph(_e(intro)),
        _details(rows),
        _password_box(password),
        _paragraph(
            "The password is case-sensitive. Type it exactly as shown, including the dashes. "
            f"You can sign in with {_e(either)}.",
            size=13, color=_MUTED, margin="0 0 20px",
        ),
        _button(sign_in_url, "Sign in"),
        _callout(
            "<strong>Please change this password after signing in.</strong> "
            f'Open <a href="{_e(account_url)}" target="_blank" rel="noopener" '
            'style="color:#92400e;text-decoration:underline;">Account</a> '
            "&rarr; Change password and choose one only you know."
        ),
        _link_fallback(sign_in_url),
        _paragraph(
            f"Never share your password. The {_e(BRAND)} team will never ask for it.",
            size=13, color=_MUTED, margin="0",
        ),
    ))
    footer = (
        f"You're receiving this email because an administrator approved access to "
        f"{_e(BRAND)} for {_e(to)}. If you didn't request an account, you can ignore it."
    )
    html_body = _layout(title=subject, preheader=preheader, heading=heading, body=body, footer=footer)

    lines = [
        _greeting(name),
        "",
        intro,
        "",
        *(f"{label}: {value}" for label, value in rows),
        f"Temporary password: {_one_line(password)}",
        "",
        "The password is case-sensitive. Type it exactly as shown, including the dashes.",
        f"You can sign in with {either}.",
        "",
        f"Sign in: {sign_in_url}",
        "",
        f"Please change this password after signing in: open Account -> Change password ({account_url}).",
        "",
        f"Never share your password. The {BRAND} team will never ask for it.",
        "",
        "--",
        f"You're receiving this email because an administrator approved access to {BRAND} "
        f"for {_one_line(to)}. If you didn't request an account, you can ignore it.",
    ]
    return subject, html_body, "\n".join(lines) + "\n"


def build_password_reset_email(*, to: str, name: str, reset_url: str) -> tuple[str, str, str]:
    """(subject, html, text) for a password-reset link."""
    minutes = security.RESET_TTL_SECONDS // 60
    url = _safe_url(reset_url, app_url() + "/forgot-password")
    subject = f"Reset your {BRAND} password"
    heading = "Reset your password"
    preheader = f"Use this link within {minutes} minutes to choose a new password."
    intro = (
        f"We received a request to reset the password for your {BRAND} account. "
        "Choose a new password with the button below."
    )
    body = "".join((
        _paragraph(_e(_greeting(name))),
        _paragraph(_e(intro)),
        _button(url, "Choose a new password"),
        _paragraph(
            f"This link expires in <strong>{minutes} minutes</strong> and works only once.",
            size=14,
        ),
        _link_fallback(url),
        _callout(
            "<strong>Didn't ask for this?</strong> You can safely ignore this email. "
            "Your password won't change unless you open the link and set a new one."
        ),
    ))
    footer = (
        f"You're receiving this email because a password reset was requested for "
        f"{_e(to)} on {_e(BRAND)}."
    )
    html_body = _layout(title=subject, preheader=preheader, heading=heading, body=body, footer=footer)
    text = "\n".join((
        _greeting(name),
        "",
        intro,
        "",
        f"Choose a new password: {url}",
        "",
        f"This link expires in {minutes} minutes and works only once.",
        "",
        "Didn't ask for this? You can safely ignore this email. Your password won't "
        "change unless you open the link and set a new one.",
        "",
        "--",
        f"You're receiving this email because a password reset was requested for "
        f"{_one_line(to)} on {BRAND}.",
    )) + "\n"
    return subject, html_body, text


def build_test_email(to: str) -> tuple[str, str, str]:
    """(subject, html, text) for the admin panel's "send test email" button."""
    status = email_status()
    provider = PROVIDER_LABELS.get(status["provider"] or "", "Not configured")
    sender = f"{status['from_name']} <{status['from_email'] or 'not set'}>"
    sent_at = security.local_now().strftime("%d %b %Y, %I:%M %p") + f" ({_timezone_label()})"
    subject = f"{BRAND} test email"
    heading = "Email delivery works"
    preheader = "Your email settings are working."
    intro = (
        f"This is a test message from the {BRAND} admin panel. If you can read it, "
        "approval and password-reset emails will be delivered too."
    )
    rows = [("Provider", provider), ("Sender", sender), ("Sent", sent_at)]
    body = "".join((
        _paragraph(_e(intro)),
        _details(rows),
        _callout(
            "<strong>Landed in spam?</strong> Mark it as &ldquo;Not spam&rdquo;, and "
            "verify your sender address or domain (SPF/DKIM) with your email provider "
            "so students receive their passwords in the inbox."
        ),
    ))
    footer = f"You're receiving this because an administrator sent a test email to {_e(to)}."
    html_body = _layout(title=subject, preheader=preheader, heading=heading, body=body, footer=footer)
    text = "\n".join((
        intro,
        "",
        *(f"{label}: {value}" for label, value in rows),
        "",
        "Landed in spam? Mark it as 'Not spam', and verify your sender address or "
        "domain (SPF/DKIM) with your email provider.",
        "",
        "--",
        f"You're receiving this because an administrator sent a test email to {_one_line(to)}.",
    )) + "\n"
    return subject, html_body, text


def send_credentials_email(
    *,
    to: str,
    name: str,
    login: str,
    password: str,
    daily_limit: int | None,
    login_url: str,
    phone: str | None = None,
    new_password: bool = False,
) -> None:
    """Email the sign-in details with a temporary password (see build_credentials_email)."""
    subject, html_body, text = build_credentials_email(
        to=to, name=name, login=login, password=password, daily_limit=daily_limit,
        login_url=login_url, phone=phone, new_password=new_password,
    )
    send_email(to, subject, html_body, text)


def send_password_reset_email(*, to: str, name: str, reset_url: str) -> None:
    subject, html_body, text = build_password_reset_email(to=to, name=name, reset_url=reset_url)
    send_email(to, subject, html_body, text)


def send_test_email(to: str) -> None:
    subject, html_body, text = build_test_email(to)
    send_email(to, subject, html_body, text)
