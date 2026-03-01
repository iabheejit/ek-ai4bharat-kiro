# Socrates-EK WhatsApp Learning Platform

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4.4%2B-green)](https://www.mongodb.com/)
[![AWS Bedrock](https://img.shields.io/badge/AWS-Bedrock-orange)](https://aws.amazon.com/bedrock/)

AI-powered WhatsApp learning platform that delivers personalized micro-courses through conversational interfaces. Built for the AI4Bharat initiative to make quality education accessible.

## 🌟 Features

- **🤖 AI Course Generation**: Personalized 3-day courses using AWS Bedrock (Meta Llama 3)
- **💬 WhatsApp Native**: No app installation required, works via Twilio WhatsApp API
- **📚 Structured Learning**: 9 modules across 3 days with automated delivery
- **🎓 Certificates**: Automated PDF generation upon completion
- **📊 Progress Tracking**: Real-time student engagement monitoring
- **🔒 Production Ready**: Logging, monitoring, security, and error handling

## �️ Architecture

```
WhatsApp → Twilio → Express → MongoDB
                      ↓
              AWS Bedrock (Llama 3)
                      ↓
              CloudWatch Monitoring
```

**Tech Stack**: Node.js, Express, MongoDB, AWS Bedrock, Twilio, Docker, Winston

## � Quick Start

### Prerequisites

- Node.js 18+, MongoDB 4.4+
- [Twilio Account](https://www.twilio.com/try-twilio) with WhatsApp enabled
- [AWS Account](https://console.aws.amazon.com/) with Bedrock access

### Installation

```bash
# Clone and install
git clone https://github.com/iabheejit/ek-ai4bharat-kiro.git
cd ek-ai4bharat-kiro
npm install

# Configure environment
cp .env.template .env
# Edit .env with your credentials

# Start MongoDB (Docker)
docker-compose up -d mongodb

# Run application
npm run dev

# Verify
curl http://localhost:3000/health
```

## ⚙️ Configuration

### Required Environment Variables

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/socrates-ek

# Twilio (from console.twilio.com)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+1XXXXXXXXXX

# AWS Bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_BEDROCK_MODEL_ID=meta.llama3-70b-instruct-v1:0

# Application
PORT=3000
NODE_ENV=development
```

### AWS Bedrock Setup

1. **Enable Model Access**: AWS Console → Bedrock → Model access → Request "Meta Llama 3 70B"
2. **Create IAM User**: 
   ```bash
   aws iam create-user --user-name socrates-bedrock
   aws iam attach-user-policy --user-name socrates-bedrock \
     --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess
   aws iam create-access-key --user-name socrates-bedrock
   ```
3. **Add credentials to `.env`**

## 📚 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/ping` | GET | Trigger course generation |
| `/cop` | POST | Twilio webhook for messages |
| `/students` | GET | List all students |
| `/dashboard` | GET | Admin dashboard |

## �️ Project Structure

```
├── server.js              # Main application
├── db.js                  # MongoDB connection
├── llama.js               # AWS Bedrock integration
├── twilio_whatsapp.js     # Twilio integration
├── models/                # Mongoose schemas
├── flows/                 # Course flow logic
├── middleware/            # Security & error handling
├── utils/                 # Logger, monitoring
└── scripts/               # Deployment & seeding
```

## 🚢 Deployment

### Docker

```bash
docker build -t socrates-ek .
docker run -p 3000:3000 --env-file .env socrates-ek
```

### AWS ECS

See [README-AWS.md](./README-AWS.md) for complete AWS deployment guide.

```bash
./scripts/aws-setup.sh    # Setup AWS resources
./scripts/aws-deploy.sh   # Deploy application
```

## 🔒 Security

- Helmet.js security headers
- Rate limiting (100 req/15min)
- Input validation & sanitization
- Webhook signature verification
- Environment-based secrets
- MongoDB injection prevention

**Production Checklist**:
- Set `NODE_ENV=production`
- Enable webhook verification
- Use IAM roles (not access keys)
- Enable CloudWatch alarms
- Regular dependency updates

## 🛠️ Development

```bash
npm start          # Production server
npm run dev        # Development with nodemon
npm test           # Run tests
npm run seed       # Seed database
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📚 Documentation

- [AWS Deployment Guide](./README-AWS.md) - Complete ECS deployment
- [Migration Guide](./MIGRATION.md) - Airtable/WATI to MongoDB/Twilio

## 📄 License

ISC License - See [LICENSE](LICENSE) file

## 🙏 Acknowledgments

- **AI4Bharat Initiative** - AI accessibility in Indian languages
- **Ekatra Education** - Democratizing quality education
- AWS Bedrock, Twilio, MongoDB, Express.js teams

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/iabheejit/ek-ai4bharat-kiro/issues)
- **Email**: support@ekatra.one
- **Docs**: [README-AWS.md](./README-AWS.md)

---

**Built with ❤️ for accessible education**
