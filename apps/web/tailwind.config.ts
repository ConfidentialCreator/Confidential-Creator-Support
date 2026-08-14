import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      ground: '#F3EFE6',
      ink: '#151513',
      muted: '#6E6A61',
      rule: '#B8B2A5',
      refused: '#8A1C14',
      transparent: 'transparent',
      inherit: 'inherit',
    },
    fontFamily: {
      serif: [
        '"Iowan Old Style"',
        '"Palatino Linotype"',
        'Palatino',
        '"Book Antiqua"',
        'Georgia',
        'serif',
      ],
      mono: ['ui-monospace', '"Cascadia Mono"', 'Consolas', 'Menlo', 'monospace'],
    },
  },
  plugins: [],
} satisfies Config
