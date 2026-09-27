const path = require('node:path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

const common = {
  mode: 'production',
  devtool: 'source-map',
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: { loader: 'ts-loader', options: { transpileOnly: false } }
      }
    ]
  }
}

module.exports = [
  {
    ...common,
    name: 'main',
    target: 'electron-main',
    entry: './src/main/index.ts',
    output: { path: path.resolve(__dirname, 'out/main'), filename: 'index.cjs' }
  },
  {
    ...common,
    name: 'preload',
    target: 'electron-preload',
    entry: './src/preload/index.ts',
    output: { path: path.resolve(__dirname, 'out/preload'), filename: 'index.cjs' }
  },
  {
    ...common,
    name: 'renderer',
    target: 'web',
    entry: './src/renderer/src/main.tsx',
    output: { path: path.resolve(__dirname, 'out/renderer'), filename: 'app.js', clean: true },
    module: {
      rules: [
        ...common.module.rules,
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({ template: './src/renderer/index.html', inject: 'body', scriptLoading: 'defer' })
    ]
  }
]
