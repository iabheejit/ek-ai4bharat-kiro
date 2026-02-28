#!/bin/bash

# Socrates-EK AWS Infrastructure Setup Script
# This script creates all necessary AWS resources for the application

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
PROJECT_NAME="socrates-ek"
VPC_CIDR="10.0.0.0/16"
PUBLIC_SUBNET_1_CIDR="10.0.1.0/24"
PUBLIC_SUBNET_2_CIDR="10.0.2.0/24"
PRIVATE_SUBNET_1_CIDR="10.0.3.0/24"
PRIVATE_SUBNET_2_CIDR="10.0.4.0/24"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Socrates-EK AWS Infrastructure Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "This script will create:"
echo "  - VPC with public and private subnets"
echo "  - Security groups"
echo "  - Application Load Balancer"
echo "  - ECS Cluster"
echo "  - CloudWatch Log Group"
echo "  - IAM Roles"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Step 1: Create VPC
echo -e "${YELLOW}Step 1: Creating VPC...${NC}"
VPC_ID=$(aws ec2 create-vpc \
    --cidr-block $VPC_CIDR \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$PROJECT_NAME-vpc}]" \
    --region $AWS_REGION \
    --query 'Vpc.VpcId' \
    --output text)
echo -e "${GREEN}✓ VPC created: $VPC_ID${NC}"

# Enable DNS hostnames
aws ec2 modify-vpc-attribute \
    --vpc-id $VPC_ID \
    --enable-dns-hostnames \
    --region $AWS_REGION

# Step 2: Create Internet Gateway
echo -e "${YELLOW}Step 2: Creating Internet Gateway...${NC}"
IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$PROJECT_NAME-igw}]" \
    --region $AWS_REGION \
    --query 'InternetGateway.InternetGatewayId' \
    --output text)
aws ec2 attach-internet-gateway \
    --vpc-id $VPC_ID \
    --internet-gateway-id $IGW_ID \
    --region $AWS_REGION
echo -e "${GREEN}✓ Internet Gateway created: $IGW_ID${NC}"

# Step 3: Create Subnets
echo -e "${YELLOW}Step 3: Creating subnets...${NC}"

# Get availability zones
AZ1=$(aws ec2 describe-availability-zones --region $AWS_REGION --query 'AvailabilityZones[0].ZoneName' --output text)
AZ2=$(aws ec2 describe-availability-zones --region $AWS_REGION --query 'AvailabilityZones[1].ZoneName' --output text)

# Public Subnet 1
PUBLIC_SUBNET_1=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PUBLIC_SUBNET_1_CIDR \
    --availability-zone $AZ1 \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT_NAME-public-1}]" \
    --region $AWS_REGION \
    --query 'Subnet.SubnetId' \
    --output text)
echo -e "${GREEN}✓ Public Subnet 1 created: $PUBLIC_SUBNET_1 ($AZ1)${NC}"

# Public Subnet 2
PUBLIC_SUBNET_2=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PUBLIC_SUBNET_2_CIDR \
    --availability-zone $AZ2 \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT_NAME-public-2}]" \
    --region $AWS_REGION \
    --query 'Subnet.SubnetId' \
    --output text)
echo -e "${GREEN}✓ Public Subnet 2 created: $PUBLIC_SUBNET_2 ($AZ2)${NC}"

# Private Subnet 1
PRIVATE_SUBNET_1=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PRIVATE_SUBNET_1_CIDR \
    --availability-zone $AZ1 \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT_NAME-private-1}]" \
    --region $AWS_REGION \
    --query 'Subnet.SubnetId' \
    --output text)
echo -e "${GREEN}✓ Private Subnet 1 created: $PRIVATE_SUBNET_1 ($AZ1)${NC}"

# Private Subnet 2
PRIVATE_SUBNET_2=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PRIVATE_SUBNET_2_CIDR \
    --availability-zone $AZ2 \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT_NAME-private-2}]" \
    --region $AWS_REGION \
    --query 'Subnet.SubnetId' \
    --output text)
echo -e "${GREEN}✓ Private Subnet 2 created: $PRIVATE_SUBNET_2 ($AZ2)${NC}"

# Step 4: Create Route Tables
echo -e "${YELLOW}Step 4: Creating route tables...${NC}"

# Public Route Table
PUBLIC_RT=$(aws ec2 create-route-table \
    --vpc-id $VPC_ID \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT_NAME-public-rt}]" \
    --region $AWS_REGION \
    --query 'RouteTable.RouteTableId' \
    --output text)

aws ec2 create-route \
    --route-table-id $PUBLIC_RT \
    --destination-cidr-block 0.0.0.0/0 \
    --gateway-id $IGW_ID \
    --region $AWS_REGION > /dev/null

aws ec2 associate-route-table \
    --route-table-id $PUBLIC_RT \
    --subnet-id $PUBLIC_SUBNET_1 \
    --region $AWS_REGION > /dev/null

aws ec2 associate-route-table \
    --route-table-id $PUBLIC_RT \
    --subnet-id $PUBLIC_SUBNET_2 \
    --region $AWS_REGION > /dev/null

echo -e "${GREEN}✓ Public route table created: $PUBLIC_RT${NC}"

# Step 5: Create Security Groups
echo -e "${YELLOW}Step 5: Creating security groups...${NC}"

# ALB Security Group
ALB_SG=$(aws ec2 create-security-group \
    --group-name "$PROJECT_NAME-alb-sg" \
    --description "Security group for ALB" \
    --vpc-id $VPC_ID \
    --region $AWS_REGION \
    --query 'GroupId' \
    --output text)

aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0 \
    --region $AWS_REGION > /dev/null

aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0 \
    --region $AWS_REGION > /dev/null

echo -e "${GREEN}✓ ALB Security Group created: $ALB_SG${NC}"

# ECS Security Group
ECS_SG=$(aws ec2 create-security-group \
    --group-name "$PROJECT_NAME-ecs-sg" \
    --description "Security group for ECS tasks" \
    --vpc-id $VPC_ID \
    --region $AWS_REGION \
    --query 'GroupId' \
    --output text)

aws ec2 authorize-security-group-ingress \
    --group-id $ECS_SG \
    --protocol tcp \
    --port 3000 \
    --source-group $ALB_SG \
    --region $AWS_REGION > /dev/null

echo -e "${GREEN}✓ ECS Security Group created: $ECS_SG${NC}"

# Step 6: Create Application Load Balancer
echo -e "${YELLOW}Step 6: Creating Application Load Balancer...${NC}"
ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "$PROJECT_NAME-alb" \
    --subnets $PUBLIC_SUBNET_1 $PUBLIC_SUBNET_2 \
    --security-groups $ALB_SG \
    --region $AWS_REGION \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text)

ALB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns $ALB_ARN \
    --region $AWS_REGION \
    --query 'LoadBalancers[0].DNSName' \
    --output text)

echo -e "${GREEN}✓ ALB created: $ALB_DNS${NC}"

# Step 7: Create Target Group
echo -e "${YELLOW}Step 7: Creating Target Group...${NC}"
TG_ARN=$(aws elbv2 create-target-group \
    --name "$PROJECT_NAME-tg" \
    --protocol HTTP \
    --port 3000 \
    --vpc-id $VPC_ID \
    --target-type ip \
    --health-check-path /health \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region $AWS_REGION \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)
echo -e "${GREEN}✓ Target Group created: $TG_ARN${NC}"

# Step 8: Create ALB Listener (HTTP for now, add HTTPS later with certificate)
echo -e "${YELLOW}Step 8: Creating ALB Listener...${NC}"
aws elbv2 create-listener \
    --load-balancer-arn $ALB_ARN \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn=$TG_ARN \
    --region $AWS_REGION > /dev/null
echo -e "${GREEN}✓ ALB Listener created${NC}"

# Step 9: Create ECS Cluster
echo -e "${YELLOW}Step 9: Creating ECS Cluster...${NC}"
aws ecs create-cluster \
    --cluster-name "$PROJECT_NAME-cluster" \
    --region $AWS_REGION > /dev/null
echo -e "${GREEN}✓ ECS Cluster created: $PROJECT_NAME-cluster${NC}"

# Step 10: Create CloudWatch Log Group
echo -e "${YELLOW}Step 10: Creating CloudWatch Log Group...${NC}"
aws logs create-log-group \
    --log-group-name "/ecs/$PROJECT_NAME" \
    --region $AWS_REGION 2>/dev/null || true
echo -e "${GREEN}✓ CloudWatch Log Group created: /ecs/$PROJECT_NAME${NC}"

# Step 11: Create IAM Roles
echo -e "${YELLOW}Step 11: Creating IAM Roles...${NC}"

# ECS Task Execution Role
cat > /tmp/ecs-task-execution-role-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
    --role-name ecsTaskExecutionRole \
    --assume-role-policy-document file:///tmp/ecs-task-execution-role-trust-policy.json \
    2>/dev/null || true

aws iam attach-role-policy \
    --role-name ecsTaskExecutionRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy \
    2>/dev/null || true

# Add Secrets Manager access
cat > /tmp/secrets-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:$AWS_REGION:$AWS_ACCOUNT_ID:secret:$PROJECT_NAME/*"
    }
  ]
}
EOF

aws iam put-role-policy \
    --role-name ecsTaskExecutionRole \
    --policy-name SecretsManagerAccess \
    --policy-document file:///tmp/secrets-policy.json \
    2>/dev/null || true

echo -e "${GREEN}✓ IAM Roles created${NC}"

# Save configuration
echo -e "${YELLOW}Step 12: Saving configuration...${NC}"
cat > aws/infrastructure-config.sh <<EOF
#!/bin/bash
# Auto-generated infrastructure configuration
export AWS_REGION="$AWS_REGION"
export AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID"
export VPC_ID="$VPC_ID"
export PUBLIC_SUBNET_1="$PUBLIC_SUBNET_1"
export PUBLIC_SUBNET_2="$PUBLIC_SUBNET_2"
export PRIVATE_SUBNET_1="$PRIVATE_SUBNET_1"
export PRIVATE_SUBNET_2="$PRIVATE_SUBNET_2"
export ALB_SG="$ALB_SG"
export ECS_SG="$ECS_SG"
export ALB_ARN="$ALB_ARN"
export ALB_DNS="$ALB_DNS"
export TG_ARN="$TG_ARN"
export ECS_CLUSTER="$PROJECT_NAME-cluster"
EOF

chmod +x aws/infrastructure-config.sh
echo -e "${GREEN}✓ Configuration saved to aws/infrastructure-config.sh${NC}"

# Summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Infrastructure Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Resources Created:${NC}"
echo "  VPC ID: $VPC_ID"
echo "  Public Subnets: $PUBLIC_SUBNET_1, $PUBLIC_SUBNET_2"
echo "  Private Subnets: $PRIVATE_SUBNET_1, $PRIVATE_SUBNET_2"
echo "  ALB DNS: $ALB_DNS"
echo "  ECS Cluster: $PROJECT_NAME-cluster"
echo "  Target Group: $TG_ARN"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Create secrets in AWS Secrets Manager:"
echo "     aws secretsmanager create-secret --name $PROJECT_NAME/production --secret-string '{...}'"
echo ""
echo "  2. Deploy the application:"
echo "     ./scripts/aws-deploy.sh"
echo ""
echo "  3. Update Twilio webhook URL to:"
echo "     http://$ALB_DNS/cop"
echo ""
echo "  4. (Optional) Add HTTPS certificate to ALB for production"
echo ""
