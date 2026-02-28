# Socrates-EK WhatsApp Learning Platform

A production-ready WhatsApp-based educational platform powered by AI, enabling personalized learning experiences through conversational interfaces.

## 🌟 Features

- **WhatsApp Integration**: Seamless communication via Twilio WhatsApp API
- **AI-Powered Learning**: AWS Bedrock (Meta Llama 3) for intelligent tutoring
- **Course Management**: Structured learning paths with progress tracking
- **Certificate Generation**: Automated PDF certificates upon course completion
- **Interactive Content**: Support for images, buttons, and rich media
- **Student Analytics**: Track engagement and learning outcomes
- **Cron Jobs**: Automated daily content delivery
- **Production Ready**: Comprehensive logging, monitoring, and error handling

## 🏗️ Architecture

```
WhatsApp Users → Twilio → Express Server → MongoDB
                              ↓
                    AWS Bedrock (Meta Llama 3)
                              ↓
                    AWS S3 (Media - Optional)
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- MongoDB (local or Atlas)
- Twilio WhatsApp account
- AWS Account with Bedrock access
- AWS S3 bucket (optional, for media)

### Installation

```bash
# Clone the repository
git clone https://github.com/iabheejit/ek-ai4bharat-kiro.git
cd ek-ai4bharat-kiro

# Install dependencies
npm install

# Configure environment
cp .env.template .env
# Edit .env with your credentials

# Start MongoDB (if using Docker)
docker-compose up -d mongodb

# Run the application
npm run dev
```

### Environment Configuration

Copy `.env.template` to `.env` and configure:

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/socrates-ek

# Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# AWS Bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_BEDROCK_MODEL_ID=meta.llama3-70b-instruct-v1:0

# AWS S3 (optional)
AWS_S3_BUCKET=your_bucket_name

# Application
PORT=3000
NODE_ENV=development
TZ=Asia/Kolkata
```

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

# Run specific test file
npm test -- airtable_methods.test.js

# Test Twilio integration
node scripts/test_whatsapp.js

# Test full course flow
node scripts/test_full_flow.js
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

- **Helmet.js**: Security headers
- **Rate Limiting**: Prevent abuse
- **Input Validation**: Sanitize all inputs
- **Secrets Management**: Environment variables for sensitive data
- **HTTPS Only**: Enforce secure connections in production

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

- [AWS Deployment Guide](./README-AWS.md)
- [WhatsApp Interactive Buttons](./WHATSAPP_INTERACTIVE_BUTTONS.md)
- [Migration Guide](./MIGRATION.md)
- [Missing Items & Known Issues](./MISSING_ITEMS.md)

## 🙏 Acknowledgments

Built with support from:
- AI4Bharat Initiative
- Ekatra Education Platform
- Open source community

---

Built with ❤️ for accessible education
