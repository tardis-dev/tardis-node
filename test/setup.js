const { init } = require('../dist')

module.exports = async () => {
  if (process.env.http_proxy) {
    init({
      proxy: process.env.http_proxy
    })
  }
}
