console.log('Loading function');
var AWS = require('aws-sdk');

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    let request = JSON.parse(event.body);
    console.log(request);

    var operation = event.operation;

    let statusCode = 200;
    let data = "";

    switch (request.operation) {
        case 'echo':
            data = "hello... hello... hello...";
            break;
        case 'ping':
            data = "pong";
            break;
        default:
            data = `Unknown Operation: ${request.operation}`;
            statusCode = 405;
    };

    let response = {
        statusCode: statusCode,
        headers: {},
        body: JSON.stringify({
            data: data
        })
    };

    return response;
};