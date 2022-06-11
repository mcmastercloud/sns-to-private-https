console.log('Loading function');
var AWS = require('aws-sdk');
const https = require('https');

function postRequest(path, payload) {
    const options = {
        hostname: process.env.API_HOST,
        path: path,
        method: 'POST',
        port: 443,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let rawData = '';

          res.on('data', chunk => {
              rawData += chunk;
          });

          req.on('error', err => {
            reject(new Error(err));
          });

          res.on('end', () => {
              try {
                  console.log(rawData);
                  resolve(JSON.parse(rawData));
              } catch (err) {
                  reject(new Error(err));
              }
          });
        });



        req.write(JSON.stringify(payload));

        req.end();
    });
}

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    for(var record of event["Records"]) {
        if("Sns" in record) {
            console.log("Sns Record Found");
            console.log(`Message: "${record["Sns"]["Message"]}"`);

            var message = JSON.parse(record["Sns"]["Message"]);
            if(!("path" in message) || !("payload" in message)) {
                console.log("Error: Could not find the path and payload variables");
                return "Error";
            } else {
                var path = message.path;
                var payload = message.payload;
                console.log(`Path: ${path}`)
                console.log(`Payload: ${payload}`)

                const result = await postRequest(path, payload);
                console.log('result is: ', result);
                return result
            }
        }
    }
}