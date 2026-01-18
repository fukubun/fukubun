module.exports = {
  content: [
    './views/**/*.ejs',
    './public/**/*.js'
  ],
  safelist: [
    // 開発中に動的に使うクラスがある場合に追加
    // 'text-body', 'bg-neutral-quaternary', 'border-default', 'timeline-dot'
  ],
  theme: {
    extend: {
      colors: {
        // 必要ならここにカスタムカラーを追加
        // 'neutral-quaternary': '#E5E7EB',
        // 'body': '#4B5563'
      }
    }
  },
  plugins: []
}