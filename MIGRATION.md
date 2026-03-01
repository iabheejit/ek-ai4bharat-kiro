# Socrates-EK: Airtable → MongoDB Migration

## Overview

Migrate the Socrates-EK WhatsApp learning platform from Airtable to local MongoDB, WATI to Twilio WhatsApp API, and Azure Llama to AWS Bedrock for AI-powered course generation.

## Architecture

```
                      Before                              After
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│  WhatsApp User                  │   │  WhatsApp User                  │
│       ↓                         │   │       ↓                         │
│  WATI Webhook → Express Server  │   │  Twilio Webhook → Express Server│
│       ↓                         │   │       ↓                         │
│  Airtable (Student table)       │   │  MongoDB (students collection)  │
│  Airtable (dynamic Topic_Phone  │   │  MongoDB (course_contents coll) │
│           tables per student)   │   │       ↓                         │
│       ↓                         │   │  Twilio WhatsApp API            │
│  WATI WhatsApp API              │   │  AWS Bedrock (Meta Llama 3)     │
│  Azure Llama                    │   │  Winston Logging + Middleware   │
└─────────────────────────────────┘   └─────────────────────────────────┘
```

## Database Schema Migration

### Airtable → MongoDB Mapping

#### Student Table → `students` collection

| Airtable Field     | MongoDB Field        | Type              | Notes                         |
|--------------------|----------------------|-------------------|-------------------------------|
| Phone              | phone                | String (unique)   | Primary lookup key            |
| Name               | name                 | String            |                               |
| Topic              | topic                | String            | Was also table name prefix    |
| Course Status      | courseStatus          | String (enum)     | Pending Approval → Approved → Content Created / Failed |
| Progress           | progress             | String (enum)     | In Progress → Pending → Completed |
| Next Day           | nextDay              | Number            | 1-based                       |
| Day Completed      | dayCompleted         | Number            |                               |
| Next Module        | nextModule           | Number            | 1-3                           |
| Module Completed   | moduleCompleted      | Number            |                               |
| Goal               | goal                 | String            |                               |
| Style              | style                | String            |                               |
| Language           | language             | String            |                               |
| Last_Msg           | lastMsg              | String            | State tracking                |
| Responses          | responses            | String            | Open-ended responses          |
| Question Responses | questionResponses    | String            | Q&A responses                 |
| Doubt              | doubt                | Number (0/1)      | Doubt-solving mode flag       |
| Source             | source               | String            | e.g. "COP"                    |
| Course             | course               | String            |                               |
| Created            | createdAt            | Date (auto)       | Mongoose timestamps           |

#### Dynamic Course Tables → `course_contents` collection

**Before:** One Airtable table per student-course named `{Topic}_{Phone}` with columns `Module 1 Text`, `Module 2 Text`, etc.

**After:** Single collection with compound index `{studentPhone, topic, day}`. Module columns normalized into a `modules[]` subdocument array.

| Airtable Column      | MongoDB Path              | Type     |
|----------------------|---------------------------|----------|
| Day                  | day                       | Number   |
| Module N Text        | modules[N-1].text         | String   |
| Module N LTitle      | modules[N-1].listTitle    | String   |
| Module N List        | modules[N-1].list         | [String] |
| Module N iBody       | modules[N-1].interactiveBody | String |
| Module N iButtons    | modules[N-1].interactiveButtons | [String] |
| Module N Question    | modules[N-1].question     | String   |
| Module N Ans         | modules[N-1].answer       | String   |
| Module N File        | modules[N-1].files        | [{filename, url}] |

#### Alfred Waitlist → `alfred_waitlist` collection

| Airtable Field | MongoDB Field | Type   |
|----------------|---------------|--------|
| Phone          | phone         | String |
| Topic          | topic         | String |

## Function Migration Map

### airtable_methods.js → db_methods.js

| Old Function               | New Implementation                                         |
|----------------------------|-----------------------------------------------------------|
| updateField(id, field, val)| Student.findByIdAndUpdate(id, {[field]: val})             |
| getID(phone)               | Student.findOne({phone}).select('_id')                    |
| totalDays(phone)           | CourseContent.countDocuments({studentPhone, topic})        |
| markDayComplete(phone)     | Student.findOneAndUpdate + increment logic                |
| findTable(phone)           | Student.findOne({phone}).select('topic')                  |
| findRecord(id)             | Student.findById(id).select('questionResponses')          |
| findQuesRecord(id)         | Student.findById(id).select('responses')                  |
| findTitle(day, mod, phone) | CourseContent.findOne → modules[mod-1].listTitle/list     |
| findInteractive(day,mod,ph)| CourseContent.findOne → modules[mod-1].interactiveBody/Buttons |
| findQuestion(day,mod,phone)| CourseContent.findOne → modules[mod-1].question           |
| findLastMsg(phone)         | Student.findOne({phone}).select('lastMsg')                |
| find_ContentField(f,d,m,p) | CourseContent.findOne → modules[mod-1][field]             |
| findField(field, phone)    | Student.findOne({phone}).select(field)                    |
| findAns(day, mod, phone)   | CourseContent.findOne → modules[mod-1].answer             |
| createTable(name, fields)  | No-op (no dynamic collections)                            |
| updateCourseTable(old,new) | No-op                                                     |
| create_record(arr, name)   | CourseContent.insertMany()                                |
| create_student_record(...)  | Student.create({...defaults})                            |
| update_student_record(id)  | Student.findByIdAndUpdate(id, {defaults})                 |
| create_course_record(...)   | Student.create({...pending})                             |
| find_student_record(phone) | Student.find({phone}).select('phone')                     |
| find_alfred_course_record  | Student.find({phone}).select('phone lastMsg')             |
| existingStudents()         | AlfredWaitlist.find({})                                   |
| existingStudents_internal  | Student.find({phone}).select('phone course lastMsg')      |
| update_internal_student    | Student.findByIdAndUpdate(id, {lastMsg, source:'COP'})   |
| update_student_record_v2   | Student.findByIdAndUpdate(id, {topic, reset progress})   |
| updateAlfredData           | Student.findByIdAndUpdate(id, {[field]: value})           |
| ListCourseFields(name)     | CourseContent.find({studentPhone, topic})                 |

### server.js Airtable SDK functions → Mongoose

| Old Function                         | New Implementation                                    |
|--------------------------------------|------------------------------------------------------|
| getStudentData_Created(waId)         | Student.find({courseStatus:'Content Created', phone, progress:'Pending'}) |
| updateStudentTableNextDayModule(...) | Student.findOneAndUpdate with day/module increment   |
| getStudentData_Pending(waId)         | Same as Created (they were identical)                |
| getCourseContent(table, mod, day)    | CourseContent.findOne({studentPhone, topic, day})    |
| get_student_table_send_remainder()   | Student.find({courseStatus:'Content Created', progress:'Pending'}) |
| setDoubtBit(waId, bit, title)        | Student.findOneAndUpdate({phone, topic}, {doubt})    |
| getDoubtBit(waId, title)             | Student.findOne({phone, topic}).select('doubt')      |

### wati.js → twilio_whatsapp.js

| Old (WATI)                        | New (Twilio)                                        |
|------------------------------------|-----------------------------------------------------|
| sendText(msg, phone)               | client.messages.create({to, from, body})            |
| sendInteractiveButtonsMessage(...) | Text message with button labels as options           |
| sendInteractiveDualButtonsMessage  | Text message with numbered options                   |
| sendListInteractive(data,body,...) | Text message with numbered list                     |
| sendDynamicInteractiveMsg(...)     | Text message with button labels                     |
| sendTemplateMessage(day,topic,...) | client.messages.create with contentSid or body      |
| sendMedia(buffer, name, phone,...) | client.messages.create with mediaUrl                |
| getMessages(phone, at)             | client.messages.list (if needed)                    |

### llama.js (kept as-is, Airtable calls replaced)

| Old                            | New                                                     |
|--------------------------------|---------------------------------------------------------|
| getApprovedRecords()           | Student.find({courseStatus: 'Approved'})                |
| createTable(courseName)        | Removed (no dynamic collections)                        |
| updateCourseRecords(tableId, data) | CourseContent.insertMany with normalized modules array |
| cleanUpStudentTable(phone)     | Student.findOneAndUpdate({phone}, {courseStatus})       |
| Azure Llama calls              | **Migrated to AWS Bedrock** — Meta Llama 3 via Converse API |

## WhatsApp Integration: WATI → Twilio

### Webhook Format Change

```javascript
// WATI incoming webhook (old)
{ waId: "919876543210", text: "hello", senderName: "John",
  buttonReply: { text: "Start Day" }, listReply: { title: "Option A" },
  eventType: "message", type: "interactive" }

// Twilio incoming webhook (new)  
{ From: "whatsapp:+1XXXXXXXXXX", Body: "hello", ProfileName: "John",
  ButtonText: "Start Day", ListReply: '{"id":"opt1","title":"Option A"}',
  SmsMessageSid: "SM...", NumMedia: "0" }
```

### Interactive Messages

Twilio WhatsApp doesn't support native interactive buttons in the same way as WATI. Options:
1. **Content Templates** — Pre-approved templates with quick-reply buttons (requires Twilio Console setup)
2. **Text fallback** — Send numbered options as plain text, parse number replies
3. **Twilio Content API** — Create content templates programmatically

We use option 2 (text fallback) for local dev, with easy swap to Content Templates for production.

## Environment Variables

### Old (.env)
```
personal_access_token=pat...
studentBase=app...
studentTable=Student
course_base=app...
apiKey=key...
base=app...
alfred_waitlist_base=app...
AIRTABLE_PERSONAL_ACCESS_TOKEN=pat...
AIRTABLE_STUDENT_BASE_ID=app...
AIRTABLE_COURSE_BASE_ID=app...
URL=live-mt-server.wati.io
API=Bearer ...
WATI_URL_FOR_CERTIFICATE=...
WAIT_API=Bearer ...
AZURE_LLAMA_API_KEY=...
AZURE_LLAMA_ENDPOINT=https://...
azurestring=...
containername=...
tuneapi=...
tuneapikey=...
port=3000
```

### New (.env)
```
MONGODB_URI=mongodb://localhost:27017/socrates
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+1XXXXXXXXXX
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_BEDROCK_MODEL_ID=meta.llama3-70b-instruct-v1:0
AWS_S3_BUCKET=...
PORT=3000
TZ=Asia/Kolkata
```

## File Structure (After Migration)

```
Nodejs_backend/
├── server.js                 # Express app, routes, webhook handler
├── db.js                     # Mongoose connection with retry
├── db_methods.js             # All DB CRUD (replaces airtable_methods.js)
├── twilio_whatsapp.js        # Twilio WhatsApp (replaces wati.js)
├── llama.js                  # Course generation + doubt solving (AWS Bedrock)
├── course_status.js          # Course approval check
├── certificate.js            # PDF certificate generation (unchanged)
├── image.js                  # Media file handling
├── visionAi.js               # Vision AI (unchanged)
├── package.json              # Updated dependencies
├── .env.template             # Environment variable template
├── Dockerfile                # Container setup
├── docker-compose.yml        # MongoDB + app services
├── MIGRATION.md              # This file
├── models/
│   ├── Student.js            # Student schema
│   ├── CourseContent.js       # Course content schema
│   └── AlfredWaitlist.js      # Waitlist schema
├── middleware/
│   ├── errorHandler.js        # Error classes, retry, circuit breaker
│   └── security.js            # Rate limiting, webhook verification
├── utils/
│   ├── logger.js              # Winston structured logging
│   ├── monitoring.js          # Health checks, system metrics
│   └── validation.js          # Input sanitization
├── scripts/
│   └── seed.js                # Sample data for local testing
├── assets/                    # Certificate images (existing)
└── fonts/                     # Certificate fonts (existing)
```

## Running Locally

```bash
# 1. Start MongoDB
brew services start mongodb-community
# or: mongod --dbpath /tmp/mongodata

# 2. Install dependencies
cd socrates-ek/Nodejs_backend
npm install

# 3. Configure environment
cp .env.template .env
# Edit .env with your Twilio + AWS Bedrock credentials

# 4. Seed sample data
node scripts/seed.js

# 5. Start server
npm run dev

# 6. Test
curl http://localhost:3000/ping
```

## Docker

```bash
docker-compose up -d
# MongoDB on 27017, App on 3000
```
