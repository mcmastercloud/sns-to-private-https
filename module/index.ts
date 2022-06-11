import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const config = new pulumi.Config();
const region = config.require("region");
const accountId = config.require("accountId");
const vpcName = config.require("vpcName");
const privateSubnetTagName = config.require("privateSubnetTagName");
const privateSubnetTagValue = config.require("privateSubnetTagValue");
const DEPLOYMENT_NAME = "SnsToPrivateHttps"
export const vpcData = aws.ec2.getVpcOutput({tags: {"Name": vpcName}});

const tagMap: { [id: string]: string; } = {};
tagMap[privateSubnetTagName] = privateSubnetTagValue

export const private_subnets = aws.ec2.getSubnetIdsOutput({
    vpcId: vpcData.id,
    tags: tagMap
});

const lambdaProxySecurityGroup = new aws.ec2.SecurityGroup(`lambda-proxy-sg-${DEPLOYMENT_NAME}`, {
    vpcId: vpcData.id,
    ingress: [{
        fromPort: 443,
        toPort: 443,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"]
    }],
    egress: [{
        fromPort: 0,
        toPort: 65535,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"]
    }],
    revokeRulesOnDelete: true
});

const apigwVpcEndpoint = new aws.ec2.VpcEndpoint(`apigw-vpce-${DEPLOYMENT_NAME}`, {
    vpcId: vpcData.id,
    vpcEndpointType: "Interface",
    privateDnsEnabled: true,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.execute-api`,
    subnetIds: private_subnets.ids,
    securityGroupIds: [lambdaProxySecurityGroup.id]
});

const lambda_role = new aws.iam.Role(`lambda-role-${DEPLOYMENT_NAME}`, {
    forceDetachPolicies: true,
    assumeRolePolicy: JSON.stringify({
     Version: "2012-10-17",
     Statement: [{
         Action: "sts:AssumeRole",
         Effect: "Allow",
         Sid: "",
         Principal: {
             Service: "lambda.amazonaws.com",
         },
     }],
 })
})

// Create Policy for the Lambda
const policy = new aws.iam.RolePolicy(`lambda-policy-${DEPLOYMENT_NAME}`, {
    role: lambda_role.id,
    policy: JSON.stringify({
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowCloudwatchAccess",
         "Resource": "*",
         "Action": [
           "logs:CreateLogGroup",
           "logs:CreateLogStream",
           "logs:PutLogEvents"
         ],
         "Effect": "Allow"
       }
     ]
   })
})

const vpcPolicyAttachment = new aws.iam.RolePolicyAttachment(`vpc-policy-${DEPLOYMENT_NAME}`, {
        role: lambda_role.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
});

const lambdaSecurityGroup = new aws.ec2.SecurityGroup(`lambda-app-sg-${DEPLOYMENT_NAME}`, {
    vpcId: vpcData.id,
    egress: [{
        fromPort: 0,
        toPort: 65535,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"]
    }],
    revokeRulesOnDelete: true
});

// Create Lambda Function
const lambdaFunction = new aws.lambda.Function(`lambda-${DEPLOYMENT_NAME}`, {
    role: lambda_role.arn,
    handler: "function_code.handler",
    runtime: "nodejs12.x",
    code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive("./lambda_app_demo_code")
    }),
    vpcConfig: {
        subnetIds: private_subnets.ids,
        securityGroupIds: [lambdaSecurityGroup.id]
    }
}, {
    dependsOn: [vpcPolicyAttachment]
});

const api = new aws.apigateway.RestApi(`api-${DEPLOYMENT_NAME}`, {
    endpointConfiguration: {
        types: "PRIVATE",
        vpcEndpointIds: [apigwVpcEndpoint.id]
    }
});

const app_rest_api_policy = new aws.apigateway.RestApiPolicy(`api-policy-${DEPLOYMENT_NAME}`, {
    restApiId: api.id,
    policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": "*",
            "Action": "execute-api:Invoke",
            "Resource": "arn:aws:exeucte-api:${region}:${accountId}:${api.id}/*",
            "Condition": {
                "IpAddress": {
                    "aws:SourceIp": "${vpcData.cidrBlock}"
                }
            }
        }
    ]
 }
 `
});

const resource = new aws.apigateway.Resource(`resource-${DEPLOYMENT_NAME}`, {
    pathPart: "app",
    parentId: api.rootResourceId,
    restApi: api.id
}, {
    dependsOn: [app_rest_api_policy]
});

const get_main = new aws.apigateway.Method(`method-${DEPLOYMENT_NAME}`, {
    restApi: api.id,
    resourceId: resource.id,
    httpMethod: "POST",
    authorization: "NONE"
}, {
     dependsOn: [app_rest_api_policy]
 });


const integration = new aws.apigateway.Integration(`get-main-int-${DEPLOYMENT_NAME}`, {
    restApi: api.id,
    resourceId: resource.id,
    httpMethod: get_main.httpMethod,
    integrationHttpMethod: "POST",
    type: "AWS_PROXY",
    uri: lambdaFunction.invokeArn
});


const app_deployment = new aws.apigateway.Deployment(`deployment-${DEPLOYMENT_NAME}`, {
    restApi: api.id
}, {
     dependsOn: [app_rest_api_policy, integration]
 });

const app_stage = new aws.apigateway.Stage(`stage-${DEPLOYMENT_NAME}`, {
    deployment: app_deployment.id,
    restApi: api.id,
    stageName: "live"
});

const app_method_settings = new aws.apigateway.MethodSettings(`method-settings-${DEPLOYMENT_NAME}`, {
    restApi: api.id,
    stageName: app_stage.stageName,
    methodPath: "*/*",
    settings: {
        metricsEnabled: false
    }
});

const lambda_permission = new aws.lambda.Permission(`apigwperm-${DEPLOYMENT_NAME}`, {
    action: "lambda:InvokeFunction",
    function: lambdaFunction.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`arn:aws:execute-api:${region}:${accountId}:${api.id}/*/${get_main.httpMethod}${resource.path}`
});

// Lambda Proxy
const lambda_proxy_role = new aws.iam.Role(`lambda-proxy-role-${DEPLOYMENT_NAME}`, {
    forceDetachPolicies: true,
    assumeRolePolicy: JSON.stringify({
     Version: "2012-10-17",
     Statement: [{
         Action: "sts:AssumeRole",
         Effect: "Allow",
         Sid: "",
         Principal: {
             Service: "lambda.amazonaws.com",
         },
     }],
 })
})

// Create Policy for the Lambda
const lambda_proxy_policy = new aws.iam.RolePolicy(`lambda-proxy-policy-${DEPLOYMENT_NAME}`, {
    role: lambda_proxy_role.id,
    policy: pulumi.interpolate`{
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowCloudwatchAccess",
         "Resource": "*",
         "Action": [
           "logs:CreateLogGroup",
           "logs:CreateLogStream",
           "logs:PutLogEvents"
         ],
         "Effect": "Allow"
       },
       {
            "Sid": "AllowApiGatewayAccess",
            "Resource": "arn:aws:execute-api:${region}:${accountId}:${api.id}/*",
            "Action": [
                "execute-api:Invoke"
            ],
            "Effect": "Allow"
       }
     ]
   }`
})

const vpcProxyPolicyAttachment = new aws.iam.RolePolicyAttachment(`vpc-proxy-policy-${DEPLOYMENT_NAME}`, {
        role: lambda_proxy_role.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
});

// Create Lambda Function
const lambdaProxyFunction = new aws.lambda.Function(`lambda-proxy-${DEPLOYMENT_NAME}`, {
    role: lambda_proxy_role.arn,
    handler: "proxy_code.handler",
    runtime: "nodejs12.x",
    timeout: 15,
    code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive("./lambda_proxy_code")
    }),
    vpcConfig: {
        subnetIds: private_subnets.ids,
        securityGroupIds: [lambdaProxySecurityGroup.id]
    },
    environment: {
        variables: {
            API_HOST: pulumi.interpolate`${app_deployment.restApi}.execute-api.${region}.amazonaws.com`
        }
    }
}, {
    dependsOn: [vpcProxyPolicyAttachment]
});

// Deploy an SNS Topic, that sends a message to the Lambda
const snsTopic = new aws.sns.Topic(`topic-${DEPLOYMENT_NAME}`, {

});

const topicSubscription = new aws.sns.TopicSubscription(`topic-lambda-sub-${DEPLOYMENT_NAME}`, {
    topic: snsTopic.arn,
    protocol: "lambda",
    endpoint: lambdaProxyFunction.arn
});

const lambdaPermission = new aws.lambda.Permission(`sns-permission-${DEPLOYMENT_NAME}`, {
    action: "lambda:InvokeFunction",
    "function": lambdaProxyFunction.name,
    principal: "sns.amazonaws.com",
    sourceArn: snsTopic.arn
})

