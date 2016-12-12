RabbitMQ Module

- [ ] Callback and promise support
- [ ] Test Driven Development
- [ ] - Jest
- [ ] - 100% coverage, including branches
- [ ] Support both AMQP & AMQPS (ssl support)
- [ ] MIT License
- [ ] Readme
- [ ] Gitignore
- [ ] Docker testing
- [ ] Documentation
- [ ] Semver
- [ ] Upto date dependencies
- [ ] Snyk Scanner
- [ ] Badges?
- [ ] AirBnB Eslint
- [ ] Continuous Integration
- [ ] - Travis
- [ ] - Run tests
- [ ] - eslint stylechecking



create exchange
- maintain feature parity with amqplib
- [ ] name of exchange
- [ ] type of exchange
- [ ] options

create queues

create bindings - exchange - queue

post message to queue

post message to exchange
- [ ] 

consume message from queue
- [ ] Acknowledge message
- [ ] Retry on failure
- [ ] Repost message to queue




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
