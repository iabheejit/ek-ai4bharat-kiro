# Socrates-EK AWS Deployment Guide

## Overview

This guide covers deploying the Socrates-EK WhatsApp learning platform to AWS. The application is production-ready with MongoDB + Twilio integration.

## Architecture

```
WhatsApp Users → Twilio → AWS ALB → ECS Fargate → DocumentDB
                                    ↓
                            CloudWatch Logs & Metrics
```

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- Docker installed locally
- Twilio WhatsApp account
- AWS Bedrock access enabled
- MongoDB Atlas account OR AWS DocumentDB

## Quick Start

### 1. Local Testing First

```bash
# Install dependencies
npm install

# Configure environment
cp .env.template .env
# Edit .env with your credentials

# Start MongoDB locally
docker-compose up -d mongodb

# Run the application
npm run dev

# Test health endpoint
curl http://localhost:3000/health
```

### 2. Deploy to AWS

```bash
# Build and push Docker image
./scripts/aws-deploy.sh

# Or use the step-by-step guide below
```

## Detailed AWS Setup

### Step 1: Database Setup

**Option A: MongoDB Atlas (Recommended)**
1. Create MongoDB Atlas cluster
2. Whitelist AWS IP ranges
3. Get connection string
4. Update `MONGODB_URI` in AWS Secrets Manager

**Option B: AWS DocumentDB**
```bash
# Create DocumentDB cluster
aws docdb create-db-cluster \
  --db-cluster-identifier socrates-ek-cluster \
  --engine docdb \
  --master-username admin \
  --master-user-password <password> \
  --vpc-security-group-ids <sg-id>

# Create instance
aws docdb create-db-instance \
  --db-instance-identifier socrates-ek-instance \
  --db-instance-class db.t3.medium \
  --engine docdb \
  --db-cluster-identifier socrates-ek-cluster
```

### Step 2: Container Registry

```bash
# Create ECR repository
aws ecr create-repository --repository-name socrates-ek

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push image
docker build -t socrates-ek .
docker tag socrates-ek:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/socrates-ek:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/socrates-ek:latest
```

### Step 3: Secrets Management

```bash
# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name socrates-ek/production \
  --secret-string '{
    "MONGODB_URI": "mongodb://...",
    "TWILIO_ACCOUNT_SID": "AC...",
    "TWILIO_AUTH_TOKEN": "...",
    "TWILIO_WHATSAPP_NUMBER": "whatsapp:+1XXXXXXXXXX",
    "AWS_REGION": "us-east-1",
    "AWS_ACCESS_KEY_ID": "...",
    "AWS_SECRET_ACCESS_KEY": "...",
    "AWS_BEDROCK_MODEL_ID": "meta.llama3-70b-instruct-v1:0",
    "AWS_S3_BUCKET": "..."
  }'
```

### Step 4: ECS Cluster Setup

```bash
# Create ECS cluster
aws ecs create-cluster --cluster-name socrates-ek-cluster

# Create task definition (see task-definition.json)
aws ecs register-task-definition --cli-input-json file://aws/task-definition.json

# Create ECS service
aws ecs create-service \
  --cluster socrates-ek-cluster \
  --service-name socrates-ek-service \
  --task-definition socrates-ek:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=socrates-ek,containerPort=3000"
```

### Step 5: Load Balancer Setup

```bash
# Create Application Load Balancer
aws elbv2 create-load-balancer \
  --name socrates-ek-alb \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx

# Create target group
aws elbv2 create-target-group \
  --name socrates-ek-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-xxx \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn <alb-arn> \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=<cert-arn> \
  --default-actions Type=forward,TargetGroupArn=<tg-arn>
```

### Step 6: CloudWatch Monitoring

```bash
# Create log group
aws logs create-log-group --log-group-name /ecs/socrates-ek

# Create alarms
aws cloudwatch put-metric-alarm \
  --alarm-name socrates-ek-high-error-rate \
  --alarm-description "Alert when error rate exceeds 5%" \
  --metric-name Errors \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

### Step 7: Configure Twilio Webhook

1. Get your ALB DNS name or custom domain
2. Update Twilio webhook URL to: `https://your-domain.com/cop`
3. Enable webhook signature validation in production

## Environment Variables

Required environment variables for AWS deployment:

```bash
# Database
MONGODB_URI=mongodb://...

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+1XXXXXXXXXX

# AWS Bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_BEDROCK_MODEL_ID=meta.llama3-70b-instruct-v1:0

# AWS S3 (optional)
AWS_S3_BUCKET=...

# Application
PORT=3000
NODE_ENV=production
TZ=Asia/Kolkata
```

## Monitoring and Logs

### View Logs
```bash
# Stream logs from CloudWatch
aws logs tail /ecs/socrates-ek --follow

# Filter error logs
aws logs filter-log-events \
  --log-group-name /ecs/socrates-ek \
  --filter-pattern "ERROR"
```

### Check Metrics
```bash
# View ECS service metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=socrates-ek-service \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average
```

## Scaling

### Auto Scaling Configuration
```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/socrates-ek-cluster/socrates-ek-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/socrates-ek-cluster/socrates-ek-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://scaling-policy.json
```

## Backup and Recovery

### DocumentDB Backups
```bash
# Create manual snapshot
aws docdb create-db-cluster-snapshot \
  --db-cluster-identifier socrates-ek-cluster \
  --db-cluster-snapshot-identifier socrates-ek-snapshot-$(date +%Y%m%d)

# Restore from snapshot
aws docdb restore-db-cluster-from-snapshot \
  --db-cluster-identifier socrates-ek-cluster-restored \
  --snapshot-identifier socrates-ek-snapshot-20240115
```

### MongoDB Atlas Backups
- Automated continuous backups enabled by default
- Point-in-time recovery available
- Restore via Atlas UI or API

## Troubleshooting

### Common Issues

**ECS tasks failing to start**
```bash
# Check task logs
aws ecs describe-tasks \
  --cluster socrates-ek-cluster \
  --tasks <task-id>

# Check CloudWatch logs
aws logs tail /ecs/socrates-ek --since 1h
```

**Database connection issues**
```bash
# Test connectivity from ECS task
aws ecs execute-command \
  --cluster socrates-ek-cluster \
  --task <task-id> \
  --container socrates-ek \
  --interactive \
  --command "/bin/bash"

# Inside container
curl -v telnet://<docdb-endpoint>:27017
```

**Twilio webhook not receiving messages**
- Verify ALB security group allows inbound HTTPS
- Check Twilio webhook URL configuration
- Verify SSL certificate is valid
- Test webhook endpoint: `curl https://your-domain.com/health`

## Cost Optimization

### Estimated Monthly Costs (us-east-1)

- **ECS Fargate (2 tasks, 0.5 vCPU, 1GB RAM)**: ~$30
- **DocumentDB (1 instance, db.t3.medium)**: ~$100
- **Application Load Balancer**: ~$20
- **CloudWatch Logs (10GB)**: ~$5
- **Data Transfer**: ~$10
- **Total**: ~$165/month

### Cost Savings Tips
1. Use MongoDB Atlas free tier for development
2. Use Fargate Spot for non-critical workloads
3. Enable CloudWatch Logs retention policies
4. Use Reserved Instances for predictable workloads

## Security Best Practices

1. **Network Security**
   - Use private subnets for ECS tasks
   - Restrict security group rules
   - Enable VPC Flow Logs

2. **Secrets Management**
   - Store all secrets in AWS Secrets Manager
   - Rotate credentials regularly
   - Use IAM roles instead of access keys

3. **Application Security**
   - Enable Twilio webhook signature validation
   - Implement rate limiting
   - Use HTTPS only
   - Keep dependencies updated

4. **Monitoring**
   - Set up CloudWatch alarms
   - Enable AWS GuardDuty
   - Review CloudTrail logs regularly

## Support

For issues or questions:
- Check CloudWatch Logs: `/ecs/socrates-ek`
- Review application logs for errors
- Test endpoints: `/health`, `/ping`
- Contact: support@ekatra.one
