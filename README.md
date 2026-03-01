# Socrates-EK WhatsApp Learning Platform

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4.4%2B-green)](https://www.mongodb.com/)
[![AWS Bedrock](https://img.shields.io/badge/AWS-Bedrock-orange)](https://aws.amazon.com/bedrock/)

A production-ready WhatsApp-based educational platform powered by AI, enabling personalized learning experiences through conversational interfaces. Built for the AI4Bharat initiative to make quality education accessible through WhatsApp.

## 📖 Table of Contents

- [Features](#-features)
- [How It Works](#-how-it-works)
- [Architecture](#️-architecture)
- [Quick Start](#-quick-start)
- [AWS Bedrock Setup](#-aws-bedrock-setup)
- [API Endpoints](#-api-endpoints)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

## 🌟 Features

### Core Capabilities
- **🤖 AI-Powered Course Generation**: Automatically creates personalized 3-day micro-courses using AWS Bedrock (Meta Llama 3)
- **💬 WhatsApp Native**: Seamless integration with Twilio WhatsApp API - no app installation required
- **📚 Structured Learning**: 9 modules across 3 days with daily automated delivery
- **🎓 Certificate Generation**: Automated PDF certificates with custom branding upon course completion
- **📊 Progress Tracking**: Real-time monitoring of student engagement and completion rates
- **🔄 Interactive Flows**: Conversational onboarding and course navigation
- **🌐 Multi-language Support**: Course content in multiple languages (configurable)
- **📈 Analytics Dashboard**: Track student performance and course effectiveness

### Technical Features
- **Production Ready**: Comprehensive error handling, logging (Winston), and monitoring
- **Scalable Architecture**: Docker containerization, AWS ECS Fargate deployment
- **Security First**: Helmet.js, rate limiting, input validation, webhook verification
- **Database**: MongoDB with Mongoose ODM for flexible data modeling
- **Cron Jobs**: Automated daily content delivery using node-cron
- **Health Monitoring**: Built-in health checks and CloudWatch integration

## 💡 How It Works

### Student Journey

1. **Onboarding** 📱
   - Student sends a message to the WhatsApp number
   - Bot collects: Name, learning goal, preferred topic, teaching style, language
   
2. **Course Generation** 🤖
   - AI generates personalized 3-day course (9 modules total)
   - Content tailored to student's goal and learning style
   - Stored in MongoDB for delivery

3. **Daily Delivery** 📅
   - Automated cron job sends modules at scheduled times
   - 3 modules per day delivered via WhatsApp
   - Interactive buttons for navigation (Next, Previous, Repeat)

4. **Completion** 🎓
   - After completing all modules, student receives certificate
   - PDF certificate generated with student name and course topic
   - Delivered directly via WhatsApp

5. **Doubt Solving** 💭
   - Students can ask questions anytime
   - AI-powered responses using AWS Bedrock
   - Context-aware answers based on course content

### Use Cases

- **Corporate Training**: Onboard employees with micro-courses on company policies
- **Skill Development**: Teach programming, languages, or soft skills
- **Educational Institutions**: Supplement classroom learning with WhatsApp courses
- **NGOs**: Deliver educational content to underserved communities
- **Personal Development**: Self-paced learning on any topic

## 🏗️ Architecture

```
WhatsApp Users → Twilio Webhook → Express Server → MongoDB
                                        ↓
                              AWS Bedrock (Meta Llama 3)
                                        ↓
                              AWS S3 (Media - Optional)
                                        ↓
                              CloudWatch (Monitoring)
```

### Technology Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Node.js 18+, Express.js |
| **Database** | MongoDB 4.4+ (Mongoose ODM) |
| **AI/LLM** | AWS Bedrock (Meta Llama 3) |
| **Messaging** | Twilio WhatsApp API |
| **Storage** | AWS S3 (optional) |
| **Logging** | Winston |
| **Security** | Helmet.js, express-rate-limit |
| **Deployment** | Docker, AWS ECS Fargate |
| **Monitoring** | AWS CloudWatch |

## 🚀 Quick Start

### Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** and npm installed ([Download](https://nodejs.org/))
- **MongoDB 4.4+** running locally or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) account
- **Twilio Account** with WhatsApp enabled ([Sign up](https://www.twilio.com/try-twilio))
- **AWS Account** with Bedrock access enabled ([AWS Console](https://console.aws.amazon.com/))
- **Git** installed for cloning the repository

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/iabheejit/ek-ai4bharat-kiro.git
cd ek-ai4bharat-kiro

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.template .env
# Edit .env with your credentials (see below)

# 4. Start MongoDB (if using Docker)
docker-compose up -d mongodb

# 5. Seed the database with sample data (optional)
npm run seed

# 6. Start the development server
npm run dev
```

### Verify Installation

```bash
# Check if server is running
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"2026-02-28T...","uptime":...}

# Check MongoDB connection
curl http://localhost:3000/ping

# Expected response:
# "pong"
```

### Environment Configuration

Copy `.env.template` to `.env` and configure the following:

#### Required Variables

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/socrates-ek

# Twilio WhatsApp (Get from https://console.twilio.com)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# AWS Bedrock (See AWS Bedrock Setup section below)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_BEDROCK_MODEL_ID=meta.llama3-70b-instruct-v1:0

# Application
PORT=3000
NODE_ENV=development
TZ=Asia/Kolkata
```

#### Optional Variables

```bash
# AWS S3 (for file uploads)
AWS_S3_BUCKET=your_bucket_name

# Security
SKIP_WEBHOOK_VERIFY=true  # Set to false in production
WEBHOOK_URL=http://localhost:3000/cop

# Logging
LOG_LEVEL=info  # Options: error, warn, info, debug
```

## 🔧 AWS Bedrock Setup

AWS Bedrock is required for AI-powered course generation. Follow these steps:

### 1. Enable Bedrock Access

```bash
# Login to AWS Console
# Navigate to: AWS Bedrock → Model access
# Request access to: Meta Llama 3 70B Instruct
# Wait for approval (usually instant for most regions)
```

### 2. Create IAM User with Bedrock Permissions

```bash
# Create IAM user via AWS Console or CLI
aws iam create-user --user-name socrates-ek-bedrock

# Attach Bedrock policy
aws iam attach-user-policy \
  --user-name socrates-ek-bedrock \
  --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess

# Create access keys
aws iam create-access-key --user-name socrates-ek-bedrock
```

### 3. Configure Environment Variables

Add the access key and secret to your `.env` file:

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_BEDROCK_MODEL_ID=meta.llama3-70b-instruct-v1:0
```

### 4. Test Bedrock Connection

```bash
# Start the server
npm run dev

# Trigger course generation (requires a student with courseStatus='Approved')
curl http://localhost:3000/ping
```

### Supported Bedrock Models

| Model ID | Description | Use Case |
|----------|-------------|----------|
| `meta.llama3-70b-instruct-v1:0` | Meta Llama 3 70B (Recommended) | Course generation, doubt solving |
| `meta.llama3-8b-instruct-v1:0` | Meta Llama 3 8B | Faster, lower cost |
| `anthropic.claude-3-sonnet-20240229-v1:0` | Claude 3 Sonnet | Alternative LLM |

To change models, update `AWS_BEDROCK_MODEL_ID` in `.env`.

## 📚 API Endpoints

### Health & Status
- `GET /health` - Health check endpoint
- `GET /ping` - Simple ping endpoint
- `GET /dashboard` - Admin dashboard

### WhatsApp Webhook
- `POST /cop` - Twilio webhook for incoming messages

### Student Management
- `GET /students` - List all students
- `GET /students/:phone` - Get student details
- `POST /students` - Create new student

## 🗂️ Project Structure

```
ek-aws/
├── server.js              # Main application entry point
├── db.js                  # Database connection
├── db_methods.js          # Database operations
├── models/                # Mongoose models
│   ├── Student.js
│   ├── CourseContent.js
│   ├── ConversationLog.js
│   └── AlfredWaitlist.js
├── flows/                 # Course flow logic
│   └── courseFlow.js
├── middleware/            # Express middleware
│   ├── errorHandler.js
│   └── security.js
├── utils/                 # Utility functions
│   ├── logger.js
│   ├── monitoring.js
│   └── validation.js
├── scripts/               # Utility scripts
│   ├── seed.js
│   ├── aws-setup.sh
│   └── aws-deploy.sh
├── public/                # Static files
│   └── dashboard.html
└── aws/                   # AWS deployment configs
    ├── task-definition.json
    └── scaling-policy.json
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Seed database with sample data
npm run seed

# Test health endpoint
curl http://localhost:3000/health

# Test ping endpoint (triggers course generation for approved students)
curl http://localhost:3000/ping
```

## 🚢 Deployment

### AWS Deployment

See [README-AWS.md](./README-AWS.md) for detailed AWS deployment instructions.

Quick deploy:
```bash
# Setup AWS resources
./scripts/aws-setup.sh

# Deploy application
./scripts/aws-deploy.sh
```

### Docker Deployment

```bash
# Build image
docker build -t socrates-ek .

# Run container
docker run -p 3000:3000 --env-file .env socrates-ek

# Or use docker-compose
docker-compose up
```

## 📊 Monitoring

The application includes comprehensive monitoring:

- **Winston Logger**: Structured logging to files and console
- **CloudWatch Integration**: AWS CloudWatch logs and metrics
- **Health Checks**: `/health` endpoint for load balancers
- **Error Tracking**: Automatic error logging and alerting

View logs:
```bash
# Application logs
tail -f logs/app.log

# Error logs
tail -f logs/error.log
```

## 🔒 Security

- **Helmet.js**: Security headers (XSS, clickjacking protection)
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Input Validation**: Sanitize all user inputs using validator.js
- **Secrets Management**: Environment variables, never commit `.env`
- **HTTPS Only**: Enforce secure connections in production
- **Webhook Verification**: Twilio signature validation (enable in production)
- **MongoDB Injection Prevention**: Mongoose sanitization
- **CORS**: Configured for specific origins only

### Security Checklist for Production

- [ ] Set `NODE_ENV=production`
- [ ] Set `SKIP_WEBHOOK_VERIFY=false`
- [ ] Use strong MongoDB credentials
- [ ] Enable AWS IAM roles instead of access keys
- [ ] Set up CloudWatch alarms for suspicious activity
- [ ] Enable AWS GuardDuty
- [ ] Regular dependency updates (`npm audit`)
- [ ] Implement backup strategy for MongoDB

## 🐛 Troubleshooting

### Common Issues

#### 1. MongoDB Connection Failed

**Error**: `MongooseServerSelectionError: connect ECONNREFUSED`

**Solution**:
```bash
# Check if MongoDB is running
docker ps | grep mongo

# Start MongoDB
docker-compose up -d mongodb

# Or if using local MongoDB
sudo systemctl start mongod
```

#### 2. AWS Bedrock Access Denied

**Error**: `AccessDeniedException: User is not authorized to perform: bedrock:InvokeModel`

**Solution**:
```bash
# Verify IAM permissions
aws iam get-user-policy --user-name socrates-ek-bedrock --policy-name BedrockAccess

# Request model access in AWS Console
# Bedrock → Model access → Request access to Meta Llama 3
```

#### 3. Twilio Webhook Not Receiving Messages

**Error**: Messages sent to WhatsApp but no response

**Solution**:
```bash
# 1. Check if server is accessible
curl https://your-domain.com/health

# 2. Verify Twilio webhook URL in console
# Should be: https://your-domain.com/cop

# 3. Check server logs
tail -f logs/app.log

# 4. Test webhook locally with ngrok
npx ngrok http 3000
# Update Twilio webhook to ngrok URL
```

#### 4. Course Generation Fails

**Error**: `Failed to generate course`

**Solution**:
```bash
# Check Bedrock model ID
echo $AWS_BEDROCK_MODEL_ID

# Verify model is available in your region
aws bedrock list-foundation-models --region us-east-1

# Check CloudWatch logs for detailed error
aws logs tail /ecs/socrates-ek --follow
```

#### 5. Port Already in Use

**Error**: `EADDRINUSE: address already in use :::3000`

**Solution**:
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### Debug Mode

Enable detailed logging:

```bash
# Set log level to debug
LOG_LEVEL=debug npm run dev

# View all logs
tail -f logs/app.log logs/error.log
```

### Getting Help

- **GitHub Issues**: [Report bugs](https://github.com/iabheejit/ek-ai4bharat-kiro/issues)
- **Documentation**: Check [README-AWS.md](./README-AWS.md) for deployment issues
- **Logs**: Always check `logs/app.log` and `logs/error.log` first
- **Email**: support@ekatra.one

## 🔒 Security

## 🛠️ Development

### Adding New Features

1. Create feature branch: `git checkout -b feature/your-feature`
2. Implement changes
3. Add tests
4. Update documentation
5. Submit pull request

### Code Style

- Use ES6+ features
- Follow async/await patterns
- Add JSDoc comments for functions
- Keep functions small and focused

### Database Seeding

```bash
# Seed sample data
npm run seed
```

## 📝 Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run test suite
- `npm run seed` - Seed database with sample data

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## 📄 License

ISC License - See LICENSE file for details

## 🆘 Support

For issues or questions:
- Check the [AWS Deployment Guide](./README-AWS.md)
- Review application logs
- Test endpoints: `/health`, `/ping`
- Contact: support@ekatra.one

## 🗺️ Roadmap

- [ ] Multi-language support
- [ ] Voice message support
- [ ] Advanced analytics dashboard
- [ ] Integration with more LLM providers
- [ ] Mobile app companion
- [ ] Gamification features

## 📚 Documentation

- [AWS Deployment Guide](./README-AWS.md) - Complete AWS ECS deployment instructions
- [Migration Guide](./MIGRATION.md) - Migrating from Airtable/WATI to MongoDB/Twilio
- [Contributing Guidelines](./CONTRIBUTING.md) - How to contribute to this project

## 🙏 Acknowledgments

Built with support from:
- **AI4Bharat Initiative** - Making AI accessible in Indian languages
- **Ekatra Education Platform** - Democratizing quality education
- **Open Source Community** - For the amazing tools and libraries

### Key Technologies

Special thanks to the teams behind:
- [AWS Bedrock](https://aws.amazon.com/bedrock/) - Generative AI foundation models
- [Twilio](https://www.twilio.com/) - WhatsApp Business API
- [MongoDB](https://www.mongodb.com/) - Flexible document database
- [Express.js](https://expressjs.com/) - Fast, minimalist web framework

## 📞 Contact & Support

- **Email**: support@ekatra.one
- **GitHub Issues**: [Report bugs or request features](https://github.com/iabheejit/ek-ai4bharat-kiro/issues)
- **Documentation**: [Full documentation](./README-AWS.md)

## 📜 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

---

**Built with ❤️ for accessible education**

*Making quality education accessible to everyone, everywhere, through WhatsApp.*
