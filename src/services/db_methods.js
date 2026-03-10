/**
 * db_methods.js — MongoDB replacement for airtable_methods.js
 * 
 * Maintains the same function signatures so callers don't need changes.
 * Every Airtable REST/SDK call is now a Mongoose query.
 */

require('dotenv').config();
const Student = require('./models/Student');
const CourseContent = require('./models/CourseContent');
const AlfredWaitlist = require('./models/AlfredWaitlist');

// ─── Field name mapping (Airtable field names → Mongoose field names) ───
const FIELD_MAP = {
    'Phone': 'phone',
    'Name': 'name',
    'Topic': 'topic',
    'Course Status': 'courseStatus',
    'Progress': 'progress',
    'Next Day': 'nextDay',
    'Day Completed': 'dayCompleted',
    'Next Module': 'nextModule',
    'Module Completed': 'moduleCompleted',
    'Goal': 'goal',
    'Style': 'style',
    'Language': 'language',
    'Last_Msg': 'lastMsg',
    'Responses': 'responses',
    'Question Responses': 'questionResponses',
    'Doubt': 'doubt',
    'Source': 'source',
    'Course': 'course',
};

// Map content field suffixes to module subdocument keys
const CONTENT_FIELD_MAP = {
    'Text': 'text',
    'LTitle': 'listTitle',
    'List': 'list',
    'iBody': 'interactiveBody',
    'iButtons': 'interactiveButtons',
    'Question': 'question',
    'Ans': 'answer',
    'File': 'files',
};

function mapField(airtableField) {
    return FIELD_MAP[airtableField] || airtableField;
}

// ─── Student CRUD ───

/**
 * Update a single field on a student record by ID
 * Original: PATCH to Airtable REST API
 */
async function updateField(id, field_name, updatedValue) {
    try {
        const mongoField = mapField(field_name);
        await Student.findByIdAndUpdate(id, { [mongoField]: updatedValue });
        console.log('Record updated successfully');
    } catch (error) {
        console.error('Error updating record:', error);
    }
}

/**
 * Get student record ID by phone number
 * Original: GET with filterByFormula {Phone} = "number"
 */
async function getID(number) {
    try {
        const student = await Student.findOne({ phone: number }).select('_id');
        if (student) {
            console.log("id", student._id);
            return student._id;
        } else {
            throw new Error('No matching record found');
        }
    } catch (error) {
        console.error('Error in getID:', error);
    }
}

/**
 * Count total days in a student's course content
 * Original: GET course table, count Day records
 */
const totalDays = async (number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student || !student.topic) return 0;

        const count = await CourseContent.countDocuments({
            studentPhone: number,
            topic: student.topic
        });
        console.log("total days ", count);
        return count;
    } catch (error) {
        console.error('Error in totalDays:', error);
    }
};

/**
 * Mark a day as complete — increment Next Day, reset module counters
 * Original: GET student → read Next Day → PATCH increment
 */
async function markDayComplete(number) {
    try {
        const student = await Student.findOne({ phone: number });
        if (!student) {
            console.log("No records found for the given number");
            return;
        }

        const comp_day = Number(student.nextDay);
        const nextDay = comp_day + 1;
        const total_days = await module.exports.totalDays(number);

        if (comp_day <= total_days) {
            console.log("Entered markDayComplete");

            await Student.findByIdAndUpdate(student._id, {
                nextDay: nextDay,
                dayCompleted: comp_day,
                nextModule: 1,
                moduleCompleted: 0
            });

            console.log("Complete Day " + comp_day);

            if (nextDay == total_days + 1) {
                console.log("Executing Outro for ", student.name, nextDay);
            }
        }
    } catch (error) {
        console.error('Error in markDayComplete:', error);
    }
}

/**
 * Get the Topic (course table name) for a phone number
 * Original: GET with formula filter, return Topic field
 */
const findTable = async (number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (student && student.topic) {
            console.log("findTable ", student.topic);
            return student.topic;
        }
    } catch (error) {
        console.error('Error in findTable:', error);
    }
};

/**
 * Get Question Responses field by student ID
 * Original: GET record by ID, return "Question Responses" field
 */
const findRecord = async (id) => {
    try {
        const student = await Student.findById(id).select('questionResponses');
        return student ? student.questionResponses : undefined;
    } catch (error) {
        console.error('Error in findRecord:', error);
    }
};

/**
 * Get Responses field by student ID
 * Original: GET record by ID, return "Responses" field
 */
const findQuesRecord = async (id) => {
    try {
        const student = await Student.findById(id).select('responses');
        return student ? student.responses : undefined;
    } catch (error) {
        console.error('Error in findQuesRecord:', error);
    }
};

/**
 * Get list title and options for a module
 * Original: GET course table by Day, return Module N LTitle and Module N List
 */
const findTitle = async (currentDay, module_no, number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student) return [0, 0];

        const content = await CourseContent.findOne({
            studentPhone: number,
            topic: student.topic,
            day: currentDay
        });

        if (content && content.modules[module_no - 1]) {
            const mod = content.modules[module_no - 1];
            if (mod.listTitle) {
                console.log(mod.listTitle, mod.list);
                return [mod.listTitle, mod.list];
            }
        }
        return [0, 0];
    } catch (error) {
        console.error('Error in findTitle:', error);
    }
};

/**
 * Get interactive body and buttons for a module
 * Original: GET course table by Day, return Module N iBody and Module N iButtons
 */
const findInteractive = async (currentDay, module_no, number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student) return "No records found for the given day";

        const content = await CourseContent.findOne({
            studentPhone: number,
            topic: student.topic,
            day: currentDay
        });

        if (content && content.modules[module_no - 1]) {
            const mod = content.modules[module_no - 1];
            if (mod.interactiveBody) {
                return [mod.interactiveBody, mod.interactiveButtons];
            }
        }
        return "No matching interactive content found";
    } catch (error) {
        console.error('Error in findInteractive:', error);
    }
};

/**
 * Get question text for a module
 * Original: GET course table by Day, return Module N Question
 */
const findQuestion = async (currentDay, module_no, number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student) return "No records found for the given day";

        const content = await CourseContent.findOne({
            studentPhone: number,
            topic: student.topic,
            day: currentDay
        });

        if (content && content.modules[module_no - 1]) {
            const mod = content.modules[module_no - 1];
            if (mod.question) return mod.question;
        }
        return "No matching question found";
    } catch (error) {
        console.error('Error in findQuestion:', error);
    }
};

/**
 * Get Last_Msg field by phone
 * Original: GET with formula filter, return Last_Msg
 */
const findLastMsg = async (number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('lastMsg');
        return student ? student.lastMsg : undefined;
    } catch (error) {
        console.error('Error in findLastMsg:', error);
        return undefined;
    }
};

/**
 * Get an arbitrary content field from a course module
 * Original: GET course table by Day, return Module N {field}, split by newlines
 * 
 * field: the content field suffix (e.g., "Text", "LTitle", "List", etc.)
 */
const find_ContentField = async (field, currentDay, current_module, number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student) return 0;

        const content = await CourseContent.findOne({
            studentPhone: number,
            topic: student.topic,
            day: currentDay
        });

        if (content && content.modules[current_module - 1]) {
            const mod = content.modules[current_module - 1];
            const mongoField = CONTENT_FIELD_MAP[field] || field;
            const value = mod[mongoField];

            if (value !== undefined && value !== '') {
                // If it's already an array (list, interactiveButtons, files), return as-is
                if (Array.isArray(value)) return value;
                // Otherwise split by newlines (matches original behavior)
                return value.split("\n");
            }
        }
        console.log("Feedback  0");
        return 0;
    } catch (error) {
        console.error('Error in find_ContentField:', error);
        return 0;
    }
};

/**
 * Get any arbitrary field from a student record by phone
 * Original: GET with formula filter, return field value
 */
const findField = async (field, number) => {
    try {
        const mongoField = mapField(field);
        const student = await Student.findOne({ phone: number }).select(mongoField);
        if (student) {
            const value = student[mongoField];
            return value !== undefined ? value : 0;
        }
        return 0;
    } catch (error) {
        console.error('Error in findField:', error);
        return 0;
    }
};

/**
 * Get correct answer for a module question
 * Original: GET course table by Day, return Module N Ans
 */
const findAns = async (currentDay, module_no, number) => {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student) return null;

        const content = await CourseContent.findOne({
            studentPhone: number,
            topic: student.topic,
            day: currentDay
        });

        if (content && content.modules[module_no - 1]) {
            const mod = content.modules[module_no - 1];
            return mod.answer || null;
        }
        return null;
    } catch (error) {
        console.error('Error in findAns:', error);
        return null;
    }
};

// ─── Table operations (no-ops or simplified for MongoDB) ───

/**
 * Create a course table — No-op in MongoDB (no dynamic collections)
 * Original: POST to Airtable Meta API to create a new table
 * Returns a fake "table ID" for compatibility (the topic_phone string)
 */
async function createTable(course_name, course_fields) {
    console.log(`[MongoDB] createTable called for "${course_name}" — no dynamic collection needed`);
    return course_name; // Return the name as the "ID"
}

/**
 * Rename a course table — No-op in MongoDB
 * Original: PATCH to Airtable Meta API
 */
async function updateCourseTable(course_name, new_table_name) {
    console.log(`[MongoDB] updateCourseTable: "${course_name}" → "${new_table_name}" — no-op`);
    return 200;
}

/**
 * Insert records into a course content collection
 * Original: POST records to Airtable course table
 * 
 * record_array: Array of {fields: {...}} objects (Airtable format)
 * course_name: Was the Airtable table name (Topic_Phone format)
 */
async function create_record(record_array, course_name) {
    try {
        // Parse Topic_Phone from the course_name
        const parts = course_name.split('_');
        const phone = parts.pop();
        const topic = parts.join('_');

        for (const rec of record_array) {
            const fields = rec.fields || rec;
            const day = fields.Day || fields.day;

            // Build modules array from flat Airtable fields
            const modules = [];
            for (let i = 1; i <= 3; i++) {
                modules.push({
                    text: fields[`Module ${i} Text`] || '',
                    listTitle: fields[`Module ${i} LTitle`] || '',
                    list: fields[`Module ${i} List`] ? fields[`Module ${i} List`].split('\n') : [],
                    interactiveBody: fields[`Module ${i} iBody`] || '',
                    interactiveButtons: fields[`Module ${i} iButtons`] ? fields[`Module ${i} iButtons`].split('\n') : [],
                    question: fields[`Module ${i} Question`] || '',
                    answer: fields[`Module ${i} Ans`] || '',
                    files: fields[`Module ${i} File`] || [],
                });
            }

            await CourseContent.findOneAndUpdate(
                { studentPhone: phone, topic, day },
                { studentPhone: phone, topic, day, modules },
                { upsert: true, new: true }
            );
        }
        console.log('Course records created/updated');
        return 200;
    } catch (error) {
        console.error('Error in create_record:', error);
        return error;
    }
}

/**
 * Create a new student record with initial progress fields
 * Original: POST to Airtable student table
 */
async function create_student_record(senderID, name, topic) {
    try {
        const student = await Student.create({
            phone: senderID,
            name: name,
            topic: topic,
            moduleCompleted: 0,
            nextModule: 1,
            dayCompleted: 0,
            nextDay: 1,
            progress: 'In Progress'
        });
        console.log('Student record created:', student._id);
        return 200;
    } catch (error) {
        // If duplicate, return the existing record
        if (error.code === 11000) {
            console.log('Student already exists, updating instead');
            await Student.findOneAndUpdate({ phone: senderID }, {
                name, topic,
                moduleCompleted: 0, nextModule: 1,
                dayCompleted: 0, nextDay: 1,
                progress: 'In Progress'
            });
            return 200;
        }
        console.error('Error creating student:', error);
        return error;
    }
}

/**
 * Reset student progress fields
 * Original: PATCH to reset Module/Day/Progress fields
 */
async function update_student_record(id) {
    try {
        await Student.findByIdAndUpdate(id, {
            moduleCompleted: 0,
            nextModule: 1,
            dayCompleted: 0,
            nextDay: 1,
            progress: 'In Progress'
        });
        console.log("Updated Student");
        return 200;
    } catch (error) {
        console.error("Student Update Error", error);
        return error;
    }
}

/**
 * Create a course approval record (Pending Approval status)
 * Original: POST to Airtable student table with Pending Approval
 */
async function create_course_record(senderID, name) {
    try {
        await Student.findOneAndUpdate(
            { phone: senderID },
            {
                phone: senderID,
                name: name,
                topic: '',
                courseStatus: 'Pending Approval',
                progress: 'In Progress'
            },
            { upsert: true, new: true }
        );
        console.log('Course record created');
        return 200;
    } catch (error) {
        console.error('Error creating course record:', error);
        return error;
    }
}

/**
 * Find student by phone — returns array of records (Airtable compat format)
 * Original: GET with filterByFormula Phone=senderID
 */
async function find_student_record(senderID) {
    try {
        const students = await Student.find({ phone: senderID }).select('phone');
        // Return in Airtable-like format: [{id, fields: {Phone}}]
        return students.map(s => ({
            id: s._id,
            fields: { Phone: s.phone }
        }));
    } catch (error) {
        console.error('Error in find_student_record:', error);
        return error;
    }
}

/**
 * Find student with Phone and Last_Msg fields (Alfred course record)
 * Original: GET with Phone + Last_Msg field selection
 */
async function find_alfred_course_record(senderID) {
    try {
        const students = await Student.find({ phone: senderID }).select('phone lastMsg');
        return students.map(s => ({
            id: s._id,
            fields: { Phone: s.phone, Last_Msg: s.lastMsg }
        }));
    } catch (error) {
        console.error("Alfred Record Error", error);
        return error;
    }
}

/**
 * List all students in Alfred waitlist
 * Original: GET all records from alfred_waitlist_base
 */
async function existingStudents(senderID) {
    try {
        const records = await AlfredWaitlist.find({}).select('phone topic');
        return records.map(r => ({
            id: r._id,
            fields: { Phone: r.phone, Topic: r.topic }
        }));
    } catch (error) {
        console.error('Error in existingStudents:', error);
        return error;
    }
}

/**
 * Find student with Phone, Course, Last_Msg (internal)
 * Original: GET filtered by phone with specific field selection
 */
async function existingStudents_internal(senderID) {
    try {
        const records = await Student.find({ phone: senderID }).select('phone course lastMsg');
        return records.map(r => ({
            id: r._id,
            fields: { Phone: r.phone, Course: r.course, Last_Msg: r.lastMsg }
        }));
    } catch (error) {
        console.error('Error in existingStudents_internal:', error);
        return error;
    }
}

/**
 * Update student Last_Msg and Source fields
 * Original: PATCH Last_Msg + Source="COP"
 */
async function update_internal_student_record(student_id, last_msg) {
    try {
        await Student.findByIdAndUpdate(student_id, {
            lastMsg: last_msg,
            source: 'COP'
        });
        return 200;
    } catch (error) {
        console.error('Error in update_internal_student_record:', error);
        return error;
    }
}

/**
 * Update student Topic and reset progress
 * Original: PATCH Topic + reset day/module fields
 */
async function update_student_record_v2(student_id, course_name) {
    try {
        await Student.findByIdAndUpdate(student_id, {
            topic: course_name,
            moduleCompleted: 0,
            nextModule: 1,
            dayCompleted: 0,
            nextDay: 1
        });
        return 200;
    } catch (error) {
        console.error('Error in update_student_record_v2:', error);
        return error;
    }
}

/**
 * Update an arbitrary field on a student record by ID (Alfred data)
 * Original: PATCH arbitrary field by record ID
 */
async function updateAlfredData(course_id, field_name, field_value) {
    try {
        const mongoField = mapField(field_name);
        await Student.findByIdAndUpdate(course_id, { [mongoField]: field_value });
        return 200;
    } catch (error) {
        console.error('Error in updateAlfredData:', error);
        return error;
    }
}

/**
 * List all records from a course content table
 * Original: GET all records from dynamic Airtable table
 */
async function ListCourseFields(course_name) {
    try {
        // Parse Topic_Phone from the course_name
        const parts = course_name.split('_');
        const phone = parts.pop();
        const topic = parts.join('_');

        const records = await CourseContent.find({ studentPhone: phone, topic });
        console.log(records);
        return { records };
    } catch (error) {
        console.error("List record error:", error);
        return error;
    }
}

// ─── Exports (same function names as airtable_methods.js) ───

module.exports = {
    markDayComplete,
    createTable,
    create_record,
    create_student_record,
    find_student_record,
    update_student_record,
    findTable,
    totalDays,
    updateField,
    findRecord,
    findTitle,
    findInteractive,
    findQuestion,
    findQuesRecord,
    getID,
    findLastMsg,
    findField,
    findAns,
    find_ContentField,
    existingStudents,
    find_alfred_course_record,
    create_course_record,
    updateAlfredData,
    updateCourseTable,
    ListCourseFields,
    existingStudents_internal,
    update_internal_student_record,
    update_student_record_v2,
};
