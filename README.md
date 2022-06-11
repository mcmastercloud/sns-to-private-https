# Instructions for use

## Deploying the Infrastructure

1. Open ```init.sh```, and edit the variables to match the variables for your infrastructure
    * Your subnets must have a tag called "type" which will indicate whether the Subnet is Private of Public
    * You VPC must have a name
3. Execute the ```int.sh``` file
4. Log-in to your AWS Account
5. Ensure the relevant node modules are installed by running ```npm install``` within the ```module``` folder
6. Run ```pulumi up``` within the modules folder, to create the required infrastructure

## Testing the Infrastructure

1. When the infrastructure has been successfully installed, find the SNS topic, which will ne named: ```topic-{DEPLOYMENT_NAME}-{RandomId}```
2. Click on ```Publish Message```
3. Paste a message like the following
```json
{
   "path": "/live/app",
   "payload": {
      "operation": "echo"
   }
}
```
4. Go to the Lambda, which will be named as follows: ```lambda-proxy-{DEPLOYMENT_NAME}-{RandomId}```
5. Click on ```Monitor```, and then ```View Logs in Cloudwatch```
6. Check the log messages.  You should see something as follows:

```json
  INFO result is: { data: 'hello... hello... hello...' }
```

This shows that the SNS Topic Message has been passed to lambda, and then on to the Private HTTP Endpoint, and the response is also visibile by the Lambda.