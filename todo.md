RabbitMQ Module

- [ ] Callback and promise support
- [ ] Test Driven Development
- [ ] - Jest
- [ ] - 100% coverage, including branches
- [x] Support both AMQP & AMQPS (ssl support)
- [x] MIT License
- [ ] Readme
- [x] Gitignore
- [ ] Docker testing
- [ ] Documentation
- [x] Semver
- [ ] Upto date dependencies
- [ ] Snyk Scanner
- [ ] Badges?
- [x] AirBnB Eslint
- [ ] Continuous Integration
- [x] - Travis
- [ ] - Run tests
- [ ] - eslint stylechecking
- [x] maintain feature parity with amqplib

- [x] Connection
- [x] Queues
- [x] - array of queues to create
- [x] Exchange
- [x] Bind Exchange
- [x] Post message to queue
- [x] Post message to exchange
- [ ] Get message from queue


```
const fs = require('fs')  
const path = require('path')  
const packagePath = path.resolve(__dirname, '..', 'package.json')

function packageInfo (callback) {  
  // make sure callback is initialized
  callback = callback || function () {}

  return new Promise(function (resolve, reject) {
    fs.readFile(packagePath, function (err, data) {
      if (err) {
        // reject as promise
        reject(err)
        // return callback using "error-first-pattern"
        return callback(err)
      }

      resolve(data)
      return callback(null, data)
    })
  })
}

module.exports = packageInfo  
```
