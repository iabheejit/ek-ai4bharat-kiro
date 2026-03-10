/**
 * Seed script — populate MongoDB with sample data for local testing
 * 
 * Usage: node scripts/seed.js
 * 
 * Creates:
 * - 1 sample student (phone: 919766072308) with "Content Created" status
 * - 3 days of course content (3 modules each) for topic "JavaScript"
 * - 1 sample student with "Approved" status (to test course generation)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Student = require('../src/models/Student');
const CourseContent = require('../src/models/CourseContent');

const TEST_PHONE = '919766072308';
const AlfredWaitlist = require('../src/models/AlfredWaitlist');
const ConversationLog = require('../src/models/ConversationLog');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/socrates';

async function seed() {
    console.log('Connecting to MongoDB:', MONGODB_URI);
    await mongoose.connect(MONGODB_URI);
    console.log('Connected!\n');

    // Clear existing data
    await Student.deleteMany({});
    await CourseContent.deleteMany({});
    await AlfredWaitlist.deleteMany({});
    await ConversationLog.deleteMany({});
    console.log('Cleared existing data (including conversation logs)\n');

    // ─── Create sample student (ready to receive content) ───
    const student1 = await Student.create({
        phone: TEST_PHONE,
        name: 'Test Student',
        topic: 'JavaScript',
        courseStatus: 'Content Created',
        progress: 'Pending',
        nextDay: 1,
        nextModule: 1,
        dayCompleted: 0,
        moduleCompleted: 0,
        goal: 'Learn JavaScript basics',
        style: 'Interactive',
        language: 'English',
        lastMsg: '',
        doubt: 0,
        flowStep: 'idle',
        source: 'COP'
    });
    console.log('✅ Created student:', student1.name, '(', student1.phone, ')');
    console.log('   Status:', student1.courseStatus, '| Progress:', student1.progress, '| Flow:', student1.flowStep);

    // ─── Create 3 days of course content ───
    const courseContent = [
        {
            studentPhone: TEST_PHONE,
            topic: 'JavaScript',
            day: 1,
            modules: [
                {
                    text: "🚀 Welcome to Day 1, Module 1!\n\nJavaScript is the programming language of the web. It was created by Brendan Eich in 1995 in just 10 days.\n\nToday, JavaScript runs everywhere — browsers, servers (Node.js), mobile apps, and even robots!\n\nLet's start with the basics. Variables are like containers that store data.\n\n```\nlet name = 'Socrates';\nconst age = 25;\nvar city = 'Athens';\n```\n\n💡 Quick tip: Use `let` for variables that change, `const` for constants, and avoid `var` in modern code.\n\n📝 Task: Think about 3 things you'd want to store in variables. What would you name them?",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: '',
                    answer: '',
                    files: []
                },
                {
                    text: "📦 Day 1, Module 2: Data Types\n\nJavaScript has several data types:\n\n1. **String** — Text: `'Hello World'`\n2. **Number** — Integers and decimals: `42`, `3.14`\n3. **Boolean** — True/false: `true`, `false`\n4. **Array** — Lists: `[1, 2, 3]`\n5. **Object** — Key-value pairs: `{name: 'JS', year: 1995}`\n\nYou can check a type with `typeof`:\n```\ntypeof 'hello'  // 'string'\ntypeof 42       // 'number'\ntypeof true     // 'boolean'\n```\n\n🎯 Understanding data types is fundamental — they determine what operations you can perform on your data.\n\n📝 Task: Open your browser console (F12) and try `typeof` on different values!",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: 'What does typeof "hello" return?',
                    answer: 'string',
                    files: []
                },
                {
                    text: "🔀 Day 1, Module 3: Control Flow\n\nControl flow determines which code runs based on conditions.\n\n**If/Else:**\n```\nlet score = 85;\nif (score >= 90) {\n  console.log('A grade! 🏆');\n} else if (score >= 80) {\n  console.log('B grade! 👍');\n} else {\n  console.log('Keep trying! 💪');\n}\n```\n\n**Loops:**\n```\nfor (let i = 0; i < 5; i++) {\n  console.log('Iteration:', i);\n}\n```\n\n🔑 Key concept: Loops + conditions = the foundation of all programming logic.\n\n📝 Task: Write a mental loop that counts from 1 to 10 — what would the code look like?",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: '',
                    answer: '',
                    files: []
                }
            ]
        },
        {
            studentPhone: TEST_PHONE,
            topic: 'JavaScript',
            day: 2,
            modules: [
                {
                    text: "⚡ Day 2, Module 1: Functions\n\nFunctions are reusable blocks of code. They're the building blocks of any JavaScript application.\n\n**Function Declaration:**\n```\nfunction greet(name) {\n  return `Hello, ${name}! 👋`;\n}\ngreet('Student'); // 'Hello, Student! 👋'\n```\n\n**Arrow Functions (modern):**\n```\nconst add = (a, b) => a + b;\nadd(2, 3); // 5\n```\n\n💡 Arrow functions are shorter and handle `this` differently — perfect for callbacks.\n\n📝 Task: Think of a daily task you repeat. How would you write it as a function?",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: '',
                    answer: '',
                    files: []
                },
                {
                    text: "📋 Day 2, Module 2: Arrays & Methods\n\nArrays store ordered lists of items:\n```\nconst fruits = ['apple', 'banana', 'cherry'];\n```\n\n**Essential methods:**\n- `push()` — add to end\n- `pop()` — remove from end\n- `map()` — transform each element\n- `filter()` — keep matching elements\n- `find()` — get first match\n\n```\nconst numbers = [1, 2, 3, 4, 5];\nconst doubled = numbers.map(n => n * 2); // [2, 4, 6, 8, 10]\nconst evens = numbers.filter(n => n % 2 === 0); // [2, 4]\n```\n\n🎯 Array methods are used EVERYWHERE in modern JS — master them!\n\n📝 Task: What would `[10, 20, 30].filter(n => n > 15)` return?",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: 'What does [10, 20, 30].filter(n => n > 15) return?',
                    answer: '[20, 30]',
                    files: []
                },
                {
                    text: "🏗️ Day 2, Module 3: Objects\n\nObjects store data as key-value pairs — they model real-world things:\n```\nconst student = {\n  name: 'Alex',\n  age: 22,\n  courses: ['JS', 'React'],\n  greet() {\n    return `Hi, I'm ${this.name}!`;\n  }\n};\n```\n\n**Accessing properties:**\n```\nstudent.name     // 'Alex' (dot notation)\nstudent['age']   // 22 (bracket notation)\n```\n\n**Destructuring (modern):**\n```\nconst { name, age } = student;\n// name = 'Alex', age = 22\n```\n\n🔑 Objects + arrays = JSON, the universal data format of the web!\n\n📝 Task: Model yourself as a JavaScript object — what properties would you have?",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: '',
                    answer: '',
                    files: []
                }
            ]
        },
        {
            studentPhone: TEST_PHONE,
            topic: 'JavaScript',
            day: 3,
            modules: [
                {
                    text: "🌐 Day 3, Module 1: Async JavaScript\n\nJavaScript is single-threaded but non-blocking. It handles async operations with:\n\n**Promises:**\n```\nfetch('https://api.example.com/data')\n  .then(response => response.json())\n  .then(data => console.log(data))\n  .catch(error => console.error(error));\n```\n\n**Async/Await (easier):**\n```\nasync function getData() {\n  try {\n    const response = await fetch('https://api.example.com/data');\n    const data = await response.json();\n    console.log(data);\n  } catch (error) {\n    console.error(error);\n  }\n}\n```\n\n💡 Async/await makes asynchronous code look synchronous — much easier to read!\n\n📝 Task: Think of 3 things that happen asynchronously in daily life.",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: '',
                    answer: '',
                    files: []
                },
                {
                    text: "🛠️ Day 3, Module 2: DOM & Events\n\nThe DOM (Document Object Model) is how JavaScript interacts with web pages:\n\n**Selecting elements:**\n```\nconst btn = document.querySelector('#myButton');\nconst items = document.querySelectorAll('.item');\n```\n\n**Modifying elements:**\n```\nbtn.textContent = 'Click Me!';\nbtn.style.color = 'blue';\nbtn.classList.add('active');\n```\n\n**Event listeners:**\n```\nbtn.addEventListener('click', () => {\n  alert('Button clicked! 🎉');\n});\n```\n\n🎯 The DOM is what makes web pages interactive — it bridges HTML and JavaScript.\n\n📝 Task: Right-click any webpage, select 'Inspect', and explore the DOM tree!",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: 'What method do you use to listen for user interactions like clicks?',
                    answer: 'addEventListener',
                    files: []
                },
                {
                    text: "🎓 Day 3, Module 3: What's Next?\n\nCongratulations! You've covered the JavaScript fundamentals! 🎉\n\nHere's your learning roadmap:\n\n1. **Practice** — Build small projects (calculator, todo list, quiz app)\n2. **Node.js** — Run JavaScript on servers\n3. **React/Vue** — Build modern user interfaces\n4. **APIs** — Connect to external services\n5. **TypeScript** — Add type safety to your JS code\n\n📚 Free resources:\n- MDN Web Docs (developer.mozilla.org)\n- JavaScript.info\n- FreeCodeCamp\n\n🔑 The secret to learning programming: build things. Start small, be consistent.\n\n💪 You now know variables, types, control flow, functions, arrays, objects, async, and the DOM. That's a solid foundation!\n\n📝 Final task: Plan your first mini-project. What will you build?",
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: '',
                    answer: '',
                    files: []
                }
            ]
        }
    ];

    await CourseContent.insertMany(courseContent);
    console.log('✅ Created 3 days of course content (9 modules total)\n');

    // ─── Create a second student (Approved — for testing course generation) ───
    const student2 = await Student.create({
        phone: '919988776655',
        name: 'Course Gen Test',
        topic: 'Python',
        courseStatus: 'Approved',
        progress: 'In Progress',
        nextDay: 1,
        nextModule: 1,
        dayCompleted: 0,
        moduleCompleted: 0,
        goal: 'Learn Python for data science',
        style: 'Conversational',
        language: 'English',
        lastMsg: '',
        doubt: 0
    });
    console.log('✅ Created student:', student2.name, '(', student2.phone, ') — Status: Approved');
    console.log('   This student will trigger course generation on GET /ping\n');

    // ─── Create a waitlist entry ───
    await AlfredWaitlist.create({
        phone: '919876543210',
        topic: 'Machine Learning'
    });
    console.log('✅ Created Alfred waitlist entry\n');

    // ─── Summary ───
    const studentCount = await Student.countDocuments();
    const contentCount = await CourseContent.countDocuments();
    const waitlistCount = await AlfredWaitlist.countDocuments();

    console.log('═══════════════════════════════════════');
    console.log('📊 Database seeded successfully!');
    console.log(`   Students: ${studentCount}`);
    console.log(`   Course content records: ${contentCount}`);
    console.log(`   Waitlist entries: ${waitlistCount}`);
    console.log('═══════════════════════════════════════');
    console.log('\nTest flow:');
    console.log('1. Start server: npm run dev');
    console.log('2. Test course delivery:');
    console.log('   curl -X POST http://localhost:3000/cop \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"waId":"919999888877","text":"Start Day","eventType":"message","buttonReply":{"text":"Start Day"}}\'');
    console.log('3. Test course generation: curl http://localhost:3000/ping');
    console.log('4. Check health: curl http://localhost:3000/health');

    await mongoose.disconnect();
    console.log('\nDone! MongoDB connection closed.');
}

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
