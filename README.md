# iac-pulumi
# Build and Deploy Instructions
## 1. Clone the Repository
git clone url,
```cd iac-pulumi```
## 2. Install Dependencies
```npm install```
## 3. Set up Pulumi

### set config
pulumi destroy, pulumi config set aws:region us-west-2, pulumi config get aws:region, pulumi refresh, pulumi config set aws:profile demo
### set stack
```pulumi stack select demo```

### parameter
change the AMI in the dev/demo.yaml file

### run pulumi
```pulumi up```

## Importing SSL Certificate into AWS ACM
We need these files to import SSL certificate, demo_gecoding_me_crt.pem, private_key.pem, and demo_gecoding_me_ca-bundle.pem. 
Copy these three files to the same directory, and cd to the directory.

I imported the SSL certificate obtained from Namecheap into AWS Certificate Manager using the following AWS CLI command:

```aws iam upload-server-certificate --server-certificate-name certificate_object_name --certificate-body file://demo_gecoding_me_crt.pem --private-key file://private_key.pem --certificate-chain file://demo_gecoding_me_ca-bundle.pem```


