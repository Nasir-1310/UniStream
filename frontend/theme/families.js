// Tailwind colour families that follow the light/dark theme (see generate-palette.js).
const FAMILIES = ['slate', 'indigo', 'sky', 'violet', 'purple', 'pink', 'red', 'amber', 'emerald', 'blue', 'teal', 'cyan']

/** Tailwind `colors` entries that read the CSS variables, with opacity support. */
function themedColors() {
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
  const result = { white: 'rgb(var(--tw-white) / <alpha-value>)' }
  for (const family of FAMILIES) {
    result[family] = Object.fromEntries(
      shades.map(shade => [shade, `rgb(var(--tw-${family}-${shade}) / <alpha-value>)`]),
    )
  }
  return result
}

module.exports = { FAMILIES, themedColors }
