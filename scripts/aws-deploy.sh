#!/bin/bash

# Socrates-EK AWS Deployment Script
# This script automates the deployment of Socrates-EK to AWS ECS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPOSITORY="socrates-ek"
ECS_CLUSTER="socrates-ek-cluster"
ECS_SERVICE="socrates-ek-service"
IMAGE_TAG=${IMAGE_TAG:-latest}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Socrates-EK AWS Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "AWS Account: $AWS_ACCOUNT_ID"
echo "Region: $AWS_REGION"
echo "Image Tag: $IMAGE_TAG"
echo ""

# Step 1: Create ECR repository if it doesn't exist
echo -e "${YELLOW}Step 1: Checking ECR repository...${NC}"
if ! aws ecr describe-repositories --repository-names $ECR_REPOSITORY --region $AWS_REGION > /dev/null 2>&1; then
    echo "Creating ECR repository..."
    aws ecr create-repository \
        --repository-name $ECR_REPOSITORY \
        --region $AWS_REGION \
        --image-scanning-configuration scanOnPush=true
    echo -e "${GREEN}✓ ECR repository created${NC}"
else
    echo -e "${GREEN}✓ ECR repository exists${NC}"
fi

# Step 2: Login to ECR
echo -e "${YELLOW}Step 2: Logging in to ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
echo -e "${GREEN}✓ Logged in to ECR${NC}"

# Step 3: Build Docker image
echo -e "${YELLOW}Step 3: Building Docker image...${NC}"
docker build -t $ECR_REPOSITORY:$IMAGE_TAG .
echo -e "${GREEN}✓ Docker image built${NC}"

# Step 4: Tag image
echo -e "${YELLOW}Step 4: Tagging image...${NC}"
docker tag $ECR_REPOSITORY:$IMAGE_TAG \
    $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG
echo -e "${GREEN}✓ Image tagged${NC}"

# Step 5: Push image to ECR
echo -e "${YELLOW}Step 5: Pushing image to ECR...${NC}"
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG
echo -e "${GREEN}✓ Image pushed to ECR${NC}"

# Step 6: Update task definition
echo -e "${YELLOW}Step 6: Updating ECS task definition...${NC}"
TASK_DEFINITION_FILE="aws/task-definition.json"
if [ -f "$TASK_DEFINITION_FILE" ]; then
    # Replace placeholders
    sed -e "s/<ACCOUNT_ID>/$AWS_ACCOUNT_ID/g" \
        -e "s/us-east-1/$AWS_REGION/g" \
        $TASK_DEFINITION_FILE > /tmp/task-definition.json
    
    # Register new task definition
    TASK_DEFINITION_ARN=$(aws ecs register-task-definition \
        --cli-input-json file:///tmp/task-definition.json \
        --region $AWS_REGION \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)
    
    echo -e "${GREEN}✓ Task definition registered: $TASK_DEFINITION_ARN${NC}"
else
    echo -e "${RED}✗ Task definition file not found: $TASK_DEFINITION_FILE${NC}"
    exit 1
fi

# Step 7: Update ECS service
echo -e "${YELLOW}Step 7: Updating ECS service...${NC}"
if aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --region $AWS_REGION | grep -q "ACTIVE"; then
    aws ecs update-service \
        --cluster $ECS_CLUSTER \
        --service $ECS_SERVICE \
        --task-definition $TASK_DEFINITION_ARN \
        --force-new-deployment \
        --region $AWS_REGION > /dev/null
    echo -e "${GREEN}✓ ECS service updated${NC}"
else
    echo -e "${YELLOW}⚠ ECS service not found. Please create it manually or run setup script.${NC}"
fi

# Step 8: Wait for deployment
echo -e "${YELLOW}Step 8: Waiting for deployment to complete...${NC}"
echo "This may take a few minutes..."
aws ecs wait services-stable \
    --cluster $ECS_CLUSTER \
    --services $ECS_SERVICE \
    --region $AWS_REGION

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Check service status: aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE"
echo "2. View logs: aws logs tail /ecs/socrates-ek --follow"
echo "3. Test health endpoint: curl https://your-domain.com/health"
echo ""
