"use strict";

const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require('@pulumi/gcp');
var SubnetCIDRAdviser = require('subnet-cidr-calculator');

const config = new pulumi.Config();
const awsRegion = config.require('region');

// Extracting configuration values and providing defaults when necessary
const numOfSubnets = config.requireNumber("numOfSubnets");
const vpcCidr = config.require("vpcCidr");
const subnetPrefixLength = config.require("subnetPrefixLength");
const vpcName = config.require("vpcName");
const publicRouteCidr = config.require("publicRouteCidr");


const internetGatewayName = config.require("internetGatewayName");
const publicRouteTableName = config.require("publicRouteTableName");
const privateRouteTableName = config.require("privateRouteTableName");
const publicInternetAccessRouteName = config.require("publicInternetAccessRouteName");

// ec2 instance
const instance_ami = config.require("instanceAmi");
const instance_type = config.require("instanceType");
const key_name = config.require("keyName");
const root_volume_size = parseInt(config.require("rootVolumeSize"));

// security group
const ssh_port = parseInt(config.require("sshPort"));
const http_port = parseInt(config.require("httpPort"));
const https_port = parseInt(config.require("httpsPort"));
const app_port = parseInt(config.require("appPort"));

// rds instance
const db_engine = config.require("db_engine");
const instance_class = config.require("instance_class");
const db_name = config.require("db_name");
const db_username = config.require("db_username");
const db_password = config.require("db_password");
const allocated_storage = config.requireNumber("allocated_storage");
const skip_final_snapshot = config.requireBoolean("skip_final_snapshot");
const publicly_accessible = config.requireBoolean("publicly_accessible");
const identifier = config.require("identifier");

// Route 53
const subDomain = config.require("subDomain");
const mainDomain = config.require("mainDomain");
const ttl = config.requireNumber("ttl");
const recordType = config.require("recordType");

// mailgun
const mailgunApiKey = config.requireSecret("mailgunApiKey");
// lambda file
const lambdaFilePath = config.require("lambda_filePath");
// gcs
const gcsBucketLocation = config.require('gcs_bucket_location');
const readCapacityUnits = config.require('readCapacityUnits');
const writeCapacityUnits = config.require('writeCapacityUnits');
const bucketName = config.require("bucketName");
const projectId = config.require("projectId");

// sslCertificateArn
const sslCertificateArn = config.require("sslCertificateArn");


// 1. Create the Virtual Private Cloud (VPC)
const vpc = new aws.ec2.Vpc(vpcName, {
    cidrBlock: vpcCidr,
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: {
        Name: vpcName,
    },
});

// Create an Internet Gateway and attach it to the VPC
const internetGateway = new aws.ec2.InternetGateway(internetGatewayName, {
    vpcId: vpc.id,
    tags: {
        Name: internetGatewayName,
    },
});

// Creating Public Route Table with name from configuration
const publicRouteTable = new aws.ec2.RouteTable(publicRouteTableName, {
    vpcId: vpc.id,
    tags: {
        Name: publicRouteTableName,
    },
});

// Creating a route for Public Route Table
new aws.ec2.Route(publicInternetAccessRouteName, {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: publicRouteCidr,
    gatewayId: internetGateway.id,
    tags: {
        Name: publicInternetAccessRouteName,
    },
}, { dependsOn: [internetGateway, publicRouteTable] });

// Creating Private Route Table with name from configuration
const privateRouteTable = new aws.ec2.RouteTable(privateRouteTableName, {
    vpcId: vpc.id,
    tags: {
        Name: privateRouteTableName,
    },
});

let publicSubnetIds = pulumi.output([]);
let privateSubnetIds = [];
let publicSubnetIds_lb = [];

// Create an IAM role
const role = new aws.iam.Role("cloudwatchAgentRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "ec2.amazonaws.com"
            },
        }],
    }),
});

// Attach the policy to the role to allow the CloudWatch agent to write logs and metrics
const policyArn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"; // This is an AWS managed policy
new aws.iam.RolePolicyAttachment("cloudwatchAgentPolicyAttachment", {
    role: role,
    policyArn: policyArn,
});


// Create an IAM instance profile
const instanceProfile = new aws.iam.InstanceProfile("cloudwatchAgentInstanceProfile", {
    role: role.name,
});


// assignment9
const iam = require("@pulumi/aws/iam");
const lambda = require("@pulumi/aws/lambda");
const dynamodb = require("@pulumi/aws/dynamodb");

/**
 * 1. Amazon SNS Topic Creation
 */

const myTopic = new aws.sns.Topic("myTopic", {
    displayName: "MyNotificationTopic"
});

//sns access for cloud whatch role
// Define and attach the SNS access policy
const snsAccessPolicy = new aws.iam.Policy("snsAccessPolicy", {
    description: "Policy for CloudWatch Agent Role to access SNS",
    policy: myTopic.arn.apply(topicArn => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: ["sns:Publish"],
            Effect: "Allow",
            Resource: topicArn,
        }],
    })),
});

new aws.iam.RolePolicyAttachment("snsAccessPolicyAttachment", {
    role: role,
    policyArn: snsAccessPolicy.arn,
});

// client credential

/**
 * 2. Google Cloud Storage Bucket
 */

// Create a Google Cloud Storage bucket
// const bucket = new gcp.storage.Bucket("mybucket", {
//     location: gcsBucketLocation,
//     project: projectId,
//     forceDestroy: true,
// });


/**
 * 3. Google Cloud IAM Role and Service Account
 */

// Create a Google Service Account
const serviceAccount = new gcp.serviceaccount.Account("myServiceAccount", {
    accountId: "my-service-account",
    displayName: "My Service Account",
});

//projects IAMBinding, objectUser
const projectIamBinding = new gcp.projects.IAMBinding("projectIamBinding", {
    project: projectId,
    role: "roles/storage.objectAdmin",
    members: [
        pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
    ],
});

// Create access keys for the service account
const serviceAccountKey = new gcp.serviceaccount.Key("myServiceAccountKey", {
    serviceAccountId: serviceAccount.name,
});


/**
 * 4. DynamoDB Instance
 */

// Create a DynamoDB table
const table = new dynamodb.Table("myTable", {
    attributes: [
        { name: "id", type: "S" },
    ],
    hashKey: "id",
    billingMode: "PROVISIONED",
    readCapacity: readCapacityUnits,
    writeCapacity: writeCapacityUnits,
});


/**
 * 5. Store Mailgun API Key in AWS Secrets Manager
 */
const mailgunApiKeySecret = new aws.secretsmanager.Secret("mailgunApiKey", {
    description: "Mailgun API Key"
});

const mailgunApiKeySecretValue = new aws.secretsmanager.SecretVersion("mailgunApiKeyValue", {
    secretId: mailgunApiKeySecret.id,
    secretString: mailgunApiKey,
});


/**
 * 6. AWS Lambda Function
 */

// IAM role for the Lambda function
const lambdaRole = new iam.Role("lambdaRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "lambda.amazonaws.com",
            },
        }],
    }),
});

// Attach necessary policies to the role (e.g., for SNS, DynamoDB, Google Cloud Storage access)
const lambdaSnsPolicyAttachment = new iam.RolePolicyAttachment("lambdaSnsPolicyAttachment", {
    role: lambdaRole,
    policyArn: "arn:aws:iam::aws:policy/AWSLambda_FullAccess",
});

// write logs to cloud watch
const lambdaBasicExecutionRolePolicyAttachment = new iam.RolePolicyAttachment("lambdaBasicExecutionRolePolicyAttachment", {
    role: lambdaRole,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
});

const lambdaDynamoDbPolicyAttachment = new iam.RolePolicyAttachment("lambdaDynamoDbPolicyAttachment", {
    role: lambdaRole,
    policyArn: "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
});

const lambdaSecretsManagerPolicyAttachment = new iam.RolePolicyAttachment("lambdaSecretsManagerPolicyAttachment", {
    role: lambdaRole,
    policyArn: aws.iam.ManagedPolicy.SecretsManagerReadWrite,
});

// Create the Lambda function
const myLambda = new lambda.Function("myLambdaFunction", {
    code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive(lambdaFilePath),
    }),
    role: lambdaRole.arn,
    handler: "index.handler",
    runtime: "nodejs18.x",
    environment: {
        variables: {
            GOOGLE_CLOUD_BUCKET: bucketName,
            GOOGLE_CLOUD_KEY: pulumi.secret(serviceAccountKey.privateKey),
            DYNAMODB_TABLE: table.name,
            MAILGUN_API_KEY_SECRET: mailgunApiKeySecret.id,
            MAILGUN_API_KEY: mailgunApiKey,
            DYNAMODB_TABLE_NAME: table.name,
        },
    },
});

// GOOGLE_CLOUD_KEY: pulumi.secret(serviceAccountKey.privateKey.apply(key => Buffer.from(key, 'base64').toString('ascii'))),

const snsPublishPolicy = new aws.iam.RolePolicy("snsPublishPolicy", {
    role: lambdaRole,
    policy: myTopic.arn.apply(arn => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sns:Publish",
            Resource: arn,
            Effect: "Allow",
        }],
    })),
});

// Lambda Permission for SNS
const lambdaPermission = new aws.lambda.Permission("lambdaPermission", {
    action: "lambda:InvokeFunction",
    function: myLambda.arn,
    principal: "sns.amazonaws.com",
    sourceArn: myTopic.arn,
});

// SNS Topic Subscription
const snsSubscription = new aws.sns.TopicSubscription("mySnsSubscription", {
    topic: myTopic.arn,
    protocol: "lambda",
    endpoint: myLambda.arn,
});




aws.ec2.getSubnets().then(async res => {
    let existingSubnetCIDR = [];

    for (let id of res.ids) {
        await aws.ec2.getSubnet({ id: id }).then(r => existingSubnetCIDR.push(r.cidrBlock));
    }

    const probableSubnets = SubnetCIDRAdviser.calculate(
        vpcCidr.split('/')[0],
        parseInt(vpcCidr.split('/')[1]),
        existingSubnetCIDR,
        subnetPrefixLength
    );
    // Log the output of the calculation
    // console.log("Probable Subnets: ", probableSubnets);

    aws.getAvailabilityZones({ state: "available" }).then(az => {
        // Log the retrieved availability zones
        // console.log("Availability Zones: ", az.names);

        const azLength = Math.min(numOfSubnets, az.names.length);

        for (let i = 0; i < azLength; i++) {
            // Check if the subnets are available in the probableSubnets object
            let publicCidr, privateCidr;
            if (probableSubnets.subnets && probableSubnets.subnets.length > i * 2 + 1) {
                publicCidr = probableSubnets.subnets[i * 2].value;
                privateCidr = probableSubnets.subnets[i * 2 + 1].value;
            } else {
                console.error(`Not enough subnets available for iteration ${i}`);
            }

            // console.log(`Public CIDR for iteration ${i}:`, publicCidr);
            // console.log(`Private CIDR for iteration ${i}:`, privateCidr);

            if (!publicCidr || !privateCidr) {
                console.error(`Invalid CIDR. Public: ${publicCidr}, Private: ${privateCidr}`);
                continue;
            }

            const publicSubnet = new aws.ec2.Subnet(`public-subnet-${az.names[i]}`, {
                vpcId: vpc.id,
                cidrBlock: publicCidr,
                availabilityZone: az.names[i],
                tags: {
                    Name: `public-subnet-${az.names[i]}`,
                },
            }, { dependsOn: [vpc] });
            publicSubnet.id.apply(id => {
                console.log("Public Subnet Created with ID:", id);
            });

            publicSubnet.id.apply(id => {
                publicSubnetIds = pulumi.all([publicSubnetIds, id])
                    .apply(([existingIds, newId]) => {
                        return [...existingIds, newId];
                    });
            });

            // Associating the public subnets with the public route table
            new aws.ec2.RouteTableAssociation(`public-RT-association-${az.names[i]}`, {
                subnetId: publicSubnet.id,
                routeTableId: publicRouteTable.id,
            });

            const privateSubnet = new aws.ec2.Subnet(`private-subnet-${az.names[i]}`, {
                vpcId: vpc.id,
                cidrBlock: privateCidr,
                availabilityZone: az.names[i],
                tags: {
                    Name: `private-subnet-${az.names[i]}`,
                },
            });

            // Associating the private subnets with the private route table
            new aws.ec2.RouteTableAssociation(`private-RT-association-${az.names[i]}`, {
                subnetId: privateSubnet.id,
                routeTableId: privateRouteTable.id,
            });

            privateSubnetIds.push(privateSubnet.id);
            publicSubnetIds_lb.push(publicSubnet.id);

            if (i === azLength - 1) { // Only create a security group and EC2 instance in the last subnet in the second AZ.
                // assignment8 - Create Load Balancer Security Group
                const lbSecurityGroup = new aws.ec2.SecurityGroup("lbSecurityGroup", {
                    vpcId: vpc.id,
                    description: "Security group for the load balancer",
                    ingress: [
                        // Allow from any IP for HTTP
                        // { protocol: "tcp", fromPort: http_port, toPort: http_port, cidrBlocks: [publicRouteCidr] },
                        // Allow from any IP for HTTPS
                        { protocol: "tcp", fromPort: https_port, toPort: https_port, cidrBlocks: [publicRouteCidr] },
                    ],
                    egress: [
                        {
                            protocol: "-1",
                            fromPort: 0,
                            toPort: 0,
                            cidrBlocks: ["0.0.0.0/0"],
                        },
                    ],
                });

                // Creating Security Group
                const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
                    vpcId: vpc.id,
                    description: "Security group for web application",
                    ingress: [
                        { protocol: "tcp", fromPort: ssh_port, toPort: ssh_port, cidrBlocks: [publicRouteCidr] },// SSH access
                        // { protocol: "tcp", fromPort: http_port, toPort: http_port, cidrBlocks: [publicRouteCidr] },
                        // { protocol: "tcp", fromPort: https_port, toPort: https_port, cidrBlocks: [publicRouteCidr] },
                        { protocol: "tcp", fromPort: app_port, toPort: app_port, securityGroups: [lbSecurityGroup.id] },// Only allow from load balancer

                    ],
                    egress: [
                        {
                            protocol: "-1",
                            fromPort: 0,
                            toPort: 0,
                            cidrBlocks: ["0.0.0.0/0"], // This rule allows all outbound traffic
                        },
                    ],
                    tags: { Name: "appSecurityGroup" },
                });

                // assignment6
                // 1. RDS Security Group
                const rdsSecurityGroup = new aws.ec2.SecurityGroup("rdsSecurityGroup", {
                    vpcId: vpc.id,
                    description: "RDS security group",
                    ingress: [{
                        protocol: "tcp",
                        fromPort: 3306, // MySQL port
                        toPort: 3306,
                        securityGroups: [appSecurityGroup.id] // Allowing traffic from the application
                    }],
                    tags: {
                        Name: "rdsSecurityGroup",
                    },
                });

                // 2. DB Parameter Group
                const dbParameterGroup = new aws.rds.ParameterGroup("dbParameterGroup", {
                    name: "my-db-parameter-group",
                    family: "mariadb10.6",
                    description: "DB parameter group",
                });

                const dbSubnetGroup = new aws.rds.SubnetGroup("dbSubnetGroup", {
                    name: "my_db_subnet_group",
                    subnetIds: privateSubnetIds,
                    tags: {
                        Name: "my_db_subnet_group",
                    },
                });

                // 3. RDS Instance
                const rdsInstance = new aws.rds.Instance("rdsInstance", {
                    engine: db_engine,
                    // engineVersion: "8.0.xx", 
                    instanceClass: instance_class,
                    allocatedStorage: allocated_storage,
                    name: db_name,
                    username: db_username,
                    password: db_password,
                    parameterGroupName: dbParameterGroup.name,
                    vpcSecurityGroupIds: [rdsSecurityGroup.id],
                    skipFinalSnapshot: skip_final_snapshot,
                    publiclyAccessible: publicly_accessible,
                    dbSubnetGroupName: dbSubnetGroup.name,
                    identifier: identifier,
                    tags: {
                        Name: "rdsInstance",
                    },
                });

                // Export the RDS instance endpoint
                exports.rdsEndpoint = rdsInstance.endpoint.apply(endpoint => endpoint);
                // echo "hostname=${rdsInstance.endpoint}" >> /opt/application.properties

                const userDataScript = pulumi.interpolate`#!/bin/bash
                ENV_FILE="/opt/csye6225/webapp/application.properties"

                # Writing environment variables to a file
                echo "DB_HOST=${rdsInstance.address}" > \${ENV_FILE}
                echo "DB_USER=${db_username}" >> \${ENV_FILE}
                echo "DB_PASSWORD=${db_password}" >> \${ENV_FILE}
                echo "DB_NAME=${db_name}" >> \${ENV_FILE}
                echo "DB_ENGINE=${db_engine}" >> \${ENV_FILE}
                echo "AWS_REGION=${awsRegion}" >> \${ENV_FILE}
                echo "SNS_TOPIC_ARN=${myTopic.arn}" >> \${ENV_FILE}
                # set -e
                # Restart the CloudWatch Agent
                sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \\
                    -m ec2 \\
                    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \\
                    -s
                `;


                //assignment8 - Setup Autoscaling for EC2 Instances
                // const userDataEncoded = Buffer.from(userData).toString('base64');
                const userDataEncoded = userDataScript.apply(script => Buffer.from(script, 'utf-8').toString('base64'));

                // 1.Launch Templates
                const launchTemplate = new aws.ec2.LaunchTemplate("webAppLaunchTemplate", {
                    imageId: instance_ami,
                    instanceType: instance_type,
                    keyName: key_name,
                    // vpcSecurityGroupIds: [appSecurityGroup.id],
                    iamInstanceProfile: {
                        arn: instanceProfile.arn,
                    },
                    networkInterfaces: [{
                        associatePublicIpAddress: true,
                        securityGroups: [appSecurityGroup],
                    }],
                    userData: userDataEncoded, // Base64 encoded user data
                    tagSpecifications: [{
                        resourceType: "instance",
                        tags: {
                            Name: "webInstance",
                        },
                    }],
                });

                exports.launchTemplateId = launchTemplate.id;

                // 2.Setup Application Load Balancer For the Web Application
                const appLoadBalancer = new aws.lb.LoadBalancer("appLoadBalancer", {
                    internal: false,
                    loadBalancerType: "application",
                    securityGroups: [lbSecurityGroup.id], // ID of the Load Balancer security group
                    subnets: publicSubnetIds_lb,
                });

                // Define Target Group. This is where the load balancer will forward the traffic.
                const appTargetGroup = new aws.lb.TargetGroup("appTargetGroup", {
                    port: app_port,
                    protocol: "HTTP",
                    targetType: "instance",
                    vpcId: vpc.id,
                    //healthcheck
                    healthCheck: {
                        enabled: true,//
                        interval: 30,
                        path: "/",//
                        port: "traffic-port",
                        protocol: "HTTP",//
                        healthyThreshold: 5, // Number of consecutive health check successes to consider healthy
                        unhealthyThreshold: 2, // Number of consecutive health check failures to consider unhealthy
                        timeout: 5, // Time to wait for a response
                    },
                });

                // Set up a listener on the ALB to forward HTTP traffic to the target group.
                // const httpListener = new aws.lb.Listener("httpListener", {
                //     loadBalancerArn: appLoadBalancer.arn,
                //     port: 80,
                //     defaultActions: [{
                //         type: "forward",
                //         targetGroupArn: appTargetGroup.arn,
                //     }],
                // });

                // HTTP to HTTPS redirection
                // const httpListener = new aws.lb.Listener("httpListener", {
                //     loadBalancerArn: appLoadBalancer.arn,
                //     port: 80,
                //     defaultActions: [{
                //         type: "redirect",
                //         redirect: {
                //             protocol: "HTTPS",
                //             port: "443",
                //             statusCode: "HTTP_301" // Permanent redirect
                //         },
                //     }],
                // });

                // Assignment10 - Modify the ALB Listener for HTTPS
                const httpsListener = new aws.lb.Listener("httpsListener", {
                    loadBalancerArn: appLoadBalancer.arn,
                    port: 443,
                    protocol: "HTTPS",
                    sslPolicy: "ELBSecurityPolicy-2016-08",
                    certificateArn: sslCertificateArn,
                    defaultActions: [{
                        type: "forward",
                        targetGroupArn: appTargetGroup.arn,
                    }],
                });


                // 3.Auto Scaling Group
                const autoScalingGroup = new aws.autoscaling.Group("webAppAutoScalingGroup", {
                    vpcZoneIdentifiers: [publicSubnet.id],
                    maxSize: 3,
                    minSize: 1,
                    desiredCapacity: 1,
                    launchTemplate: {
                        id: launchTemplate.id,
                        version: `$Latest`,
                    },
                    targetGroupArns: [appTargetGroup.arn], //Attach the Target Group to Auto Scaling Group
                    healthCheckGracePeriod: 300, // Grace period in seconds
                    tags: [{
                        key: "Name",
                        value: "webInstance",
                        propagateAtLaunch: true,
                        //cooldown 60
                    }],
                });

                // Define Auto-Scaling Policies
                const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
                    autoscalingGroupName: autoScalingGroup.name, // Use 'name', not 'id'
                    adjustmentType: "ChangeInCapacity",
                    scalingAdjustment: 1,
                    cooldown: 60,
                });

                const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
                    autoscalingGroupName: autoScalingGroup.name, // Use 'name', not 'id'
                    adjustmentType: "ChangeInCapacity",
                    scalingAdjustment: -1,
                    cooldown: 60,
                });

                // Attach CloudWatch Alarms to Policies
                const cpuHighAlarm = new aws.cloudwatch.MetricAlarm("cpuHighAlarm", {
                    comparisonOperator: "GreaterThanThreshold",
                    evaluationPeriods: 2,
                    metricName: "CPUUtilization",
                    namespace: "AWS/EC2",
                    period: 300,
                    statistic: "Average",
                    threshold: 5,
                    alarmActions: [scaleUpPolicy.arn],
                    dimensions: {
                        AutoScalingGroupName: autoScalingGroup.name,
                    },
                });

                const cpuLowAlarm = new aws.cloudwatch.MetricAlarm("cpuLowAlarm", {
                    comparisonOperator: "LessThanThreshold",
                    evaluationPeriods: 2,
                    metricName: "CPUUtilization",
                    namespace: "AWS/EC2",
                    period: 300,
                    statistic: "Average",
                    threshold: 3,
                    alarmActions: [scaleDownPolicy.arn],
                    dimensions: {
                        AutoScalingGroupName: autoScalingGroup.name,
                    },
                });

                /** assignment7 - Route53
                 * assignment8 - 
                 * Remove the Direct Reference to EC2 Instance's IP
                 * Update the Record to be an Alias
                 */

                // Get the hosted zone ID for the main domain
                const hostedZone = aws.route53.getZone({ name: subDomain, privateZone: false });

                const aRecord = new aws.route53.Record(subDomain, {
                    zoneId: hostedZone.then(zone => zone.id),
                    name: subDomain,
                    type: recordType, // Keep as 'A' record
                    aliases: [{
                        name: appLoadBalancer.dnsName, // DNS name of the ALB
                        zoneId: appLoadBalancer.zoneId, // Zone ID of the ALB
                        evaluateTargetHealth: true,
                    }],
                });



            } //if condition
        } //for loop

    });
});

exports.vpcId = vpc.id;
