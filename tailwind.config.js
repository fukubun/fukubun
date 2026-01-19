module.exports = {
  content: [
    './views/**/*.ejs',
    './public/**/*.js'
  ],
  safelist: [
    'sm:block',
    'sm:pl-48',
    'md:block',
    'md:hidden'
  ],
  theme: {
    extend: {
      colors: {
        // 必要ならここにカスタムカラーを追加
      }
    }
  },
  plugins: []
}