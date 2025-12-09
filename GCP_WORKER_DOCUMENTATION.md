# GCP Worker - Scheduled Messages Microservice Documentation

Comprehensive technical documentation for the **GCP Worker** microservice that processes scheduled WhatsApp messages via BullMQ queue.

---

## 📘 Table of Contents

1. [**System Architecture**](#-system-architecture)
2. [**Publisher APIs (eazybe_api_backend)**](#-publisher-apis-eazybe_api_backend)
3. [**Worker Processing Flow**](#-worker-processing-flow)
4. [**Monitoring APIs (GCP Worker)**](#-monitoring-apis-gcp-worker) 
5. [**Service Methods Documentation**](#️-service-methods-documentation)
6. [**File Type Handling**](#-file-type-handling)
7. [**WhatsApp API Integration**](#-whatsapp-api-integration)
8. [**Error Handling**](#-error-handling)
9. [**Configuration**](#-configuration)

---

## 🔄 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SHARED REDIS INSTANCE                                  │
│                        Queue: "scheduled-messages"                               │
└─────────────────────────────────────────────────────────────────────────────────┘
                    ▲                                      │
                    │ PUBLISH                              │ SUBSCRIBE
                    │ (Queue.add)                          │ (Worker listens)
                    │                                      ▼
┌───────────────────────────────────┐      ┌───────────────────────────────────────┐
│     eazybe_api_backend            │      │          GCP Worker                    │
│     (Publisher)                   │      │          (Subscriber)                  │
├───────────────────────────────────┤      ├───────────────────────────────────────┤
│ • schedulerQueueService.js        │      │ • messageWorker.js                    │
│   - publishScheduleCreate()       │      │   - Listens to queue                  │
│   - publishScheduleDelete()       │      │   - Processes jobs at scheduled time  │
│   - publishScheduleUpdate()       │      │   - Calls messageService              │
│   - publishBulkSync()             │      │   - Handles retries                   │
│   - publishUserClear()            │      │                                       │
│                                   │      │ • messageService.js                   │
│                                   │      │   - sendScheduledMessage()            │
│                                   │      │   - sendFileMessage()                 │
│                                   │      │   - handleRecurringMessage()          │
└───────────────────────────────────┘      └───────────────────────────────────────┘
```

### Data Flow

```
User Creates Schedule → DB Save → Publisher adds to Queue → Redis stores job
                                                                    │
                                                            (delay expires)
                                                                    │
Worker picks job → MessageService processes → WhatsApp API → Message Sent
                                                                    │
                                                            (if recurring)
                                                                    │
                                                    Re-queue with new delay
```

---

## 📤 Publisher APIs (eazybe_api_backend)

### 1️⃣ Create Schedule (Push to Queue)

**Trigger:** When user creates a new scheduled message

**Controller:** `crm.controllers.js`

**Service Method:** `SchedulerQueueService.publishScheduleCreate(scheduleData, sessionData)`

**Process**

- Check if user is connected to cloud via `isUserConnectedToCloud()`
- Fetch session server mapping via `fetchSessionServerMapping()`
- Transform schedule data to queue payload
- Calculate delay from scheduled time
- Calculate priority (1-7, lower = higher priority)
- Generate unique job ID: `schedule-{scheduleId}-{timestamp}-{random}`
- Add job to BullMQ queue with delay

**Payload Transformation**

```javascript
// Database schedule → Queue payload
{
  // Event metadata
  eventType: "schedule:create",
  
  // Identification
  id: scheduleData.id,
  scheduleId: scheduleData.id,
  workspaceId: scheduleData.workspace_id,
  userMobile: scheduleData.user_mobile,

  // Recipient info
  recipient: scheduleData.chat_id,           // "919876543210@c.us"
  customerMobile: scheduleData.customer_mobile,
  customerName: scheduleData.name,

  // Message content
  content: scheduleData.message,
  scheduledTime: new Date(scheduleData.time).getTime(),

  // Recurring settings
  isRecurring: scheduleData.custom_repeat > 0,
  recurrenceInterval: scheduleData.custom_repeat * 60 * 1000,  // minutes to ms
  repeatingTimes: scheduleData.reapeating_times,
  endTime: scheduleData.end_time ? new Date(scheduleData.end_time).getTime() : null,

  // File attachment
  scheduledFile: scheduleData.scheduled_file,        // S3 URL or null
  scheduledFileName: scheduleData.scheduled_file_name,

  // Cloud session info
  sessionName: sessionData.session_name,
  apiEndpoint: `${sessionData.domain}/api/sendMessage`,
  domain: sessionData.domain,

  // Metadata
  imgSrc: scheduleData.img_src,
  createdAt: Date.now(),
}
```

**Response**

```json
{
  "success": true,
  "jobId": "schedule-12345-1732912800000-abc123",
  "scheduleId": 12345,
  "delay": 86400000,
  "scheduledFor": "2025-12-01T10:00:00.000Z"
}
```

---

### 2️⃣ Delete Schedule (Remove from Queue)

**Trigger:** When user deletes a scheduled message

**Service Method:** `SchedulerQueueService.publishScheduleDelete(scheduleId)`

**Process**

- Find all jobs matching schedule ID in delayed, waiting, active states
- Remove each matching job from queue

**Response**

```json
{
  "success": true,
  "scheduleId": 12345,
  "removed": 1
}
```

---

### 3️⃣ Update Schedule Time

**Trigger:** When user updates schedule time

**Service Method:** `SchedulerQueueService.publishScheduleUpdate(scheduleId, newScheduledTime, sessionData?)`

**Process**

- Remove existing jobs for this schedule ID
- Fetch fresh schedule data from database
- Get session data if not provided
- Create new payload with updated time
- Re-add to queue with new delay

**Response**

```json
{
  "success": true,
  "scheduleId": 12345,
  "newJobId": "schedule-12345-1733000000000-xyz789",
  "scheduledFor": "2025-12-01T12:00:00.000Z"
}
```

---

### 4️⃣ Bulk Sync (On Cloud Connect)

**Trigger:** When user connects to cloud

**Endpoint:** `POST /api/v1/whatzapp/cloud/connect`

**Service Method:** `SchedulerQueueService.publishBulkSync(workspaceId, sessionData)`

**Process**

- Fetch all pending schedules for workspace (status=0, is_deleted=false)
- Push each schedule to queue via `publishScheduleCreate()`
- Track success/failure counts

**Response**

```json
{
  "success": true,
  "workspaceId": 67890,
  "total": 10,
  "pushed": 9,
  "failed": 1,
  "errors": [{ "scheduleId": 123, "error": "Invalid time" }]
}
```

---

### 5️⃣ User Clear (On Cloud Disconnect)

**Trigger:** When user disconnects from cloud

**Endpoint:** `POST /api/v1/whatzapp/cloud/disconnect`

**Service Method:** `SchedulerQueueService.publishUserClear(workspaceId)`

**Process**

- Find all jobs for workspace ID
- Remove all jobs from queue

**Response**

```json
{
  "success": true,
  "workspaceId": 67890,
  "removed": 5
}
```

---

## ⚙️ Worker Processing Flow

### Job Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌───────────┐
│ DELAYED  │────▶│ WAITING  │────▶│  ACTIVE  │────▶│ COMPLETED │
│          │     │          │     │          │     │           │
│ Job waits│     │ Ready to │     │ Being    │     │ Success!  │
│ for time │     │ process  │     │ processed│     │           │
└──────────┘     └──────────┘     └────┬─────┘     └───────────┘
                                       │
                                       │ On Error
                                       ▼
                                  ┌──────────┐     ┌───────────┐
                                  │  RETRY   │────▶│  FAILED   │
                                  │          │     │           │
                                  │ Backoff  │     │ All tries │
                                  │ 2s, 4s.. │     │ exhausted │
                                  └──────────┘     └───────────┘
```

### Worker Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Queue Name | `scheduled-messages` | BullMQ queue identifier |
| Concurrency | `10` (configurable) | Jobs processed in parallel |
| Rate Limit | `100 jobs/minute` | Maximum throughput |
| Max Attempts | `3` | Retry attempts on failure |
| Backoff Type | `exponential` | 2s, 4s, 8s delays |

### Job Processing Steps

1. **Validate Payload**
   - Check required fields: `recipient`, `content`
   - Check API config: `apiEndpoint` or `domain`

2. **Route Message Type**
   - If `scheduledFile` && `scheduledFileName` → `sendFileMessage()`
   - Else → send text message to `/api/sendText`

3. **Handle Response**
   - Success → mark job complete
   - If recurring → re-queue for next execution
   - Failure → throw error to trigger retry

---

## 📊 Monitoring APIs (GCP Worker)

### 1️⃣ Health Check

**Endpoint:** `GET /api/schedule/health`

**Auth:** 🔓 Not Required

**Description:** Health check for the queue service.

**Response**

```json
{
  "success": true,
  "status": "healthy",
  "data": {
    "redis": "ready",
    "queue": "scheduled-messages",
    "timestamp": "2025-12-01T10:00:00.000Z"
  }
}
```

---

### 2️⃣ Get Queue Status

**Endpoint:** `GET /api/schedule/queue-status`

**Auth:** 🔓 Not Required

**Description:** Get queue statistics.

**Response**

```json
{
  "success": true,
  "data": {
    "waiting": 0,
    "active": 1,
    "completed": 150,
    "failed": 2,
    "delayed": 45,
    "total": 46,
    "timestamp": "2025-12-01T10:00:00.000Z"
  }
}
```

---

### 3️⃣ Get Job by Schedule ID

**Endpoint:** `GET /api/schedule/job/:scheduleId`

**Auth:** 🔓 Not Required

**Description:** Get job details by schedule ID.

**Response**

```json
{
  "success": true,
  "data": {
    "id": "schedule-12345-1732912800000-abc123",
    "scheduleId": 12345,
    "workspaceId": 67890,
    "state": "delayed",
    "recipient": "919876543210@c.us",
    "content": "Hello! Your appointment...",
    "scheduledTime": 1732999200000,
    "isRecurring": false,
    "attemptsMade": 0,
    "delay": 86400000,
    "priority": 5
  }
}
```

---

### 4️⃣ Get User Jobs

**Endpoint:** `GET /api/schedule/user-jobs/:workspaceId`

**Auth:** 🔓 Not Required

**Description:** Get all jobs for a workspace.

**Response**

```json
{
  "success": true,
  "data": {
    "workspaceId": "67890",
    "count": 3,
    "jobs": [
      {
        "id": "schedule-12345-1732912800000-abc123",
        "scheduleId": 12345,
        "state": "delayed",
        "recipient": "919876543210@c.us",
        "scheduledTime": 1732999200000,
        "isRecurring": false
      }
    ]
  }
}
```

---

### 5️⃣ Remove Job

**Endpoint:** `DELETE /api/schedule/job/:scheduleId`

**Auth:** 🔓 Not Required

**Description:** Remove a job by schedule ID.

**Response**

```json
{
  "success": true,
  "message": "Removed 1 job(s)",
  "data": {
    "success": true,
    "removed": 1,
    "scheduleId": "12345"
  }
}
```

---

### 6️⃣ Remove User Jobs

**Endpoint:** `DELETE /api/schedule/user-jobs/:workspaceId`

**Auth:** 🔓 Not Required

**Description:** Remove all jobs for a workspace.

**Response**

```json
{
  "success": true,
  "message": "Removed 5 job(s) for workspace 67890",
  "data": {
    "success": true,
    "removed": 5,
    "workspaceId": "67890"
  }
}
```

---

## ⚙️ Service Methods Documentation

### 🧱 MessageService Methods

#### `sendScheduledMessage(payload)`

**Description:** Main entry point for sending scheduled messages. Routes to appropriate handler based on content type.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scheduleId` | number | ✅ | Unique schedule identifier |
| `recipient` | string | ✅ | WhatsApp chat ID (e.g., `919876543210@c.us`) |
| `content` | string | ✅ | Message text |
| `scheduledFile` | string | ❌ | File URL (S3) |
| `scheduledFileName` | string | ❌ | File name with extension |
| `domain` | string | ✅ | WhatsApp API server domain |
| `sessionName` | string | ✅ | WhatsApp session identifier |

**Process:**

- If `scheduledFile` && `scheduledFileName` present → route to `sendFileMessage()`
- Else → send text message to `/api/sendText`

**Response:**

```javascript
{
  success: true,
  statusCode: 200,  // or 201 for files
  data: { /* API response */ }
}
```

---

#### `sendFileMessage(scheduler, serverDomain, sessionName)`

**Description:** Sends file messages with dynamic endpoint selection based on file type.

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `scheduler.recipient` | string | WhatsApp chat ID |
| `scheduler.scheduled_file` | string | File URL |
| `scheduler.scheduled_file_name` | string | File name with extension |
| `scheduler.message` | string | Caption for the file |
| `serverDomain` | string | WhatsApp API domain |
| `sessionName` | string | Session identifier |

**Returns:** `boolean` - `true` if status 201, `false` otherwise

---

#### `determineFileTypeAndEndpoint(fileExtension, serverDomain)`

**Description:** Determines the appropriate API endpoint and mimetype based on file extension.

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `fileExtension` | string | Lowercase file extension (e.g., `jpg`, `pdf`) |
| `serverDomain` | string | WhatsApp API domain |

**Returns:**

```javascript
{
  url: "https://domain.com/api/sendImage",
  mimetype: "image/jpeg"
}
```

---

#### `handleRecurringMessage(payload, job)`

**Description:** Re-queues recurring messages for next execution.

**Process:**

1. Check if `repeatingTimes > 1` (or null for infinite)
2. Check if `endTime` not reached
3. Validate `recurrenceInterval`
4. Create new payload with:
   - Updated `scheduledTime`
   - Decremented `repeatingTimes`
   - Added `previousExecutionTime`
5. Generate new job ID
6. Add to queue with new delay

---

#### `calculatePriority(delay)`

**Description:** Calculates job priority based on delay.

| Delay | Priority | Description |
|-------|----------|-------------|
| < 1 minute | 1 | Highest priority |
| < 5 minutes | 3 | High priority |
| < 1 hour | 5 | Medium priority |
| > 1 hour | 7 | Low priority |

---

### 🛠️ Queue Management Methods

- `findJobsByScheduleId(scheduleId)` - Find jobs by schedule ID
- `findJobsByWorkspaceId(workspaceId)` - Find jobs by workspace ID
- `removeJob(scheduleId)` - Remove jobs by schedule ID
- `removeAllUserJobs(workspaceId)` - Remove all jobs for workspace
- `getJob(scheduleId)` - Get job details

---

## 📁 File Type Handling

### FILE_TYPE_MAP Configuration

```javascript
{
  video: {
    extensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', '3gp'],
    endpoint: '/api/sendVideo',
    mimePrefix: 'video/'
  },
  image: {
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'ico', 'svg', 'webp'],
    endpoint: '/api/sendImage',
    mimePrefix: 'image/'
  },
  audio: {
    extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'],
    endpoint: '/api/sendFile',
    mimePrefix: 'audio/'
  },
  document: {
    extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'odt'],
    endpoint: '/api/sendFile',
    mimePrefix: 'application/'
  }
}
```

### Special Mimetype Handling

| Extension | Mimetype |
|-----------|----------|
| `jpg`, `jpeg` | `image/jpeg` |
| `png` | `image/png` |
| `pdf` | `application/pdf` |
| Others | `{mimePrefix}{extension}` |

### Default (Unknown Types)

- Endpoint: `/api/sendFile`
- Mimetype: `application/{extension}`

---

## 📨 WhatsApp API Integration

### Text Message Request

**Endpoint:** `POST {domain}/api/sendText`

**Request Body:**

```json
{
  "chatId": "919876543210@c.us",
  "message": "Hello! Your appointment is confirmed.",
  "linkPreview": true,
  "linkPreviewHighQuality": false,
  "session": "session_ws67890"
}
```

**Expected Response:** Status `200`

---

### File Message Request

**Endpoint:** `POST {domain}/api/send{Image|Video|File}`

**Request Body:**

```json
{
  "chatId": "919876543210@c.us",
  "file": {
    "mimetype": "image/jpeg",
    "filename": "photo.jpg",
    "url": "https://s3.amazonaws.com/bucket/photo.jpg"
  },
  "reply_to": null,
  "caption": "Check out this image!",
  "session": "session_ws67890"
}
```

**Expected Response:** Status `201`

---

## 🚨 Error Handling

### Error Categories

| Status | Cause | Retryable | Description |
|--------|-------|-----------|-------------|
| `ECONNREFUSED` | API server down | ✅ Yes | Server not reachable |
| `ETIMEDOUT` | Network timeout | ✅ Yes | Request timed out |
| `401` | Unauthorized | ❌ No | Invalid credentials |
| `403` | Forbidden | ❌ No | Access denied |
| `404` | Not Found | ❌ No | Invalid endpoint |
| `500` | Server Error | ✅ Yes | API internal error |

### Retry Sequence

```
┌─────────┬──────────────┬─────────────────────────────────────────┐
│ Attempt │ Delay        │ Action                                  │
├─────────┼──────────────┼─────────────────────────────────────────┤
│ 1       │ Immediate    │ First attempt → FAILED                  │
│ 2       │ 2 seconds    │ Retry after 2s → FAILED                 │
│ 3       │ 4 seconds    │ Retry after 4s (exponential) → FAILED   │
│ -       │ -            │ Moved to FAILED state                   │
└─────────┴──────────────┴─────────────────────────────────────────┘
```

### Error Response Structure

```javascript
{
  scheduleId: 12345,
  recipient: "919876543210@c.us",
  apiEndpoint: "https://domain.com/api/sendText",
  method: "POST",
  hasFile: false,
  statusCode: 404,
  statusText: "Not Found",
  message: "API endpoint not found",
  troubleshooting: [
    "Verify the endpoint path is correct",
    "Check if the WhatsApp API server is running"
  ]
}
```

---

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | - | Environment (development/production) |
| `REDIS_HOST` | `localhost` | Redis server host |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | - | Redis password (optional) |
| `WORKER_CONCURRENCY` | `10` | Jobs processed in parallel |
| `MAX_JOB_ATTEMPTS` | `3` | Retry attempts on failure |

### Queue Default Options

```javascript
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: {
    age: 3600,      // Keep completed jobs for 1 hour
    count: 1000,    // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 86400,     // Keep failed jobs for 24 hours
  },
}
```

---

## 📁 File Structure

```
gcp/
├── src/
│   ├── config/
│   │   └── redis.js              # Redis connection
│   ├── queues/
│   │   └── messageQueue.js       # BullMQ queue definition
│   ├── workers/
│   │   └── messageWorker.js      # Job processor
│   ├── services/
│   │   └── messageService.js     # Business logic
│   ├── controllers/
│   │   └── scheduleController.js # API handlers
│   ├── routes/
│   │   └── scheduleRoutes.js     # API routes
│   ├── utils/
│   │   ├── logger.js             # JSON logging
│   │   └── validator.js          # Payload validation
│   ├── app.js                    # Express app
│   └── server.js                 # Server entry point
├── .env                          # Environment variables
├── package.json                  # Dependencies
└── WORKFLOW_DOCUMENTATION.md     # This file
```

---

## 📋 Log Summary Table

| Phase | Log Message | Key Fields |
|-------|-------------|------------|
| Worker Start | `🚀 Message Worker started` | queue, concurrency, rateLimit |
| Job Pickup | `Processing scheduled message job` | jobId, eventType, scheduleId, workspaceId, recipient, attemptCount |
| Text Sending | `Sending scheduled message` | scheduleId, recipient, apiEndpoint, hasFile |
| File Sending | `Sending scheduled file message` | scheduleId, recipient, fileName, hasFile |
| Success | `Message sent successfully` | scheduleId, recipient, statusCode |
| File Success | `File message sent successfully` | scheduleId, recipient |
| Job Done | `Job completed successfully` | jobId, scheduleId, recipient, sentAt |
| Event | `✅ Job completed` | jobId, scheduleId, sentAt |
| Send Fail | `Failed to send message` | error, scheduleId, recipient, apiEndpoint |
| Job Fail | `Job processing failed` | error, jobId, scheduleId, recipient, attemptCount |
| Event | `❌ Job failed` | error, jobId, scheduleId, attemptsMade, maxAttempts |
| Recurring | `Recurring message re-queued` | scheduleId, oldJobId, newJobId, nextExecutionIn, remainingRepetitions |
| Recurring Done | `Recurring message completed all repetitions` | scheduleId |
| Recurring End | `Recurring message reached end time` | scheduleId |

---

## 🔍 Monitoring Commands

### API Endpoints

```bash
# Health check
curl http://localhost:3000/api/schedule/health

# Queue statistics
curl http://localhost:3000/api/schedule/queue-status

# Get specific job
curl http://localhost:3000/api/schedule/job/12345

# Get all jobs for workspace
curl http://localhost:3000/api/schedule/user-jobs/67890

# Remove specific job
curl -X DELETE http://localhost:3000/api/schedule/job/12345

# Remove all workspace jobs
curl -X DELETE http://localhost:3000/api/schedule/user-jobs/67890
```

### Redis CLI Commands

```bash
# Check Redis connection
redis-cli ping

# Count delayed jobs
redis-cli ZCARD bull:scheduled-messages:delayed

# View delayed jobs with scores
redis-cli ZRANGE bull:scheduled-messages:delayed 0 -1 WITHSCORES

# View all queue keys
redis-cli KEYS "bull:scheduled-messages:*"

# Monitor Redis in real-time
redis-cli MONITOR
```

---

# ✅ GCP Worker Functional Test Checklist

---

## 🧩 **1. Publisher Integration**

---

### **1.1 Schedule Create — `publishScheduleCreate()`**

- [ ] **TC-SC-01** Schedule pushed to queue successfully
- [ ] **TC-SC-02** Delay calculated correctly from scheduled time
- [ ] **TC-SC-03** Priority assigned based on delay
- [ ] **TC-SC-04** Job ID generated with correct format
- [ ] **TC-SC-05** Payload transformation accurate

---

### **1.2 Schedule Delete — `publishScheduleDelete()`**

- [ ] **TC-SD-01** Job removed from delayed state
- [ ] **TC-SD-02** Job removed from waiting state
- [ ] **TC-SD-03** Non-existent schedule returns removed: 0

---

### **1.3 Schedule Update — `publishScheduleUpdate()`**

- [ ] **TC-SU-01** Old job removed, new job created
- [ ] **TC-SU-02** Fresh data fetched from database
- [ ] **TC-SU-03** New delay calculated correctly

---

### **1.4 Bulk Sync — `publishBulkSync()`**

- [ ] **TC-BS-01** All pending schedules pushed
- [ ] **TC-BS-02** Failed pushes tracked in errors array
- [ ] **TC-BS-03** Empty schedules handled gracefully

---

### **1.5 User Clear — `publishUserClear()`**

- [ ] **TC-UC-01** All workspace jobs removed
- [ ] **TC-UC-02** Count returned accurately

---

## ⚙️ **2. Worker Processing**

---

### **2.1 Job Pickup**

- [ ] **TC-WP-01** Job picked up when delay expires
- [ ] **TC-WP-02** Payload validated correctly
- [ ] **TC-WP-03** Missing recipient/content throws error

---

### **2.2 Text Message Sending**

- [ ] **TC-TM-01** Text message sent to `/api/sendText`
- [ ] **TC-TM-02** Payload includes linkPreview fields
- [ ] **TC-TM-03** Status 200 returns success

---

### **2.3 File Message Sending**

- [ ] **TC-FM-01** Image routed to `/api/sendImage`
- [ ] **TC-FM-02** Video routed to `/api/sendVideo`
- [ ] **TC-FM-03** Document routed to `/api/sendFile`
- [ ] **TC-FM-04** Mimetype determined correctly
- [ ] **TC-FM-05** Caption passed correctly
- [ ] **TC-FM-06** Status 201 returns success

---

### **2.4 Error Handling**

- [ ] **TC-EH-01** Connection error triggers retry
- [ ] **TC-EH-02** 500 error triggers retry
- [ ] **TC-EH-03** 404 error fails immediately
- [ ] **TC-EH-04** Max attempts reached → job moves to failed

---

### **2.5 Recurring Messages**

- [ ] **TC-RM-01** Successful send triggers re-queue
- [ ] **TC-RM-02** repeatingTimes decremented
- [ ] **TC-RM-03** repeatingTimes = 1 stops recurring
- [ ] **TC-RM-04** endTime reached stops recurring
- [ ] **TC-RM-05** New job ID generated for re-queue

---

## 📊 **3. Monitoring APIs**

---

### **3.1 Health Check — `/api/schedule/health`**

- [ ] **TC-HC-01** Returns healthy status
- [ ] **TC-HC-02** Redis status included

---

### **3.2 Queue Status — `/api/schedule/queue-status`**

- [ ] **TC-QS-01** All states counted correctly
- [ ] **TC-QS-02** Total calculated accurately

---

### **3.3 Get Job — `/api/schedule/job/:scheduleId`**

- [ ] **TC-GJ-01** Job found returns details
- [ ] **TC-GJ-02** Job not found returns 404

---

### **3.4 Get User Jobs — `/api/schedule/user-jobs/:workspaceId`**

- [ ] **TC-GUJ-01** All workspace jobs returned
- [ ] **TC-GUJ-02** Empty workspace returns count: 0

---

### **3.5 Remove Job — `DELETE /api/schedule/job/:scheduleId`**

- [ ] **TC-RJ-01** Job removed successfully
- [ ] **TC-RJ-02** Non-existent job returns removed: 0

---

### **3.6 Remove User Jobs — `DELETE /api/schedule/user-jobs/:workspaceId`**

- [ ] **TC-RUJ-01** All workspace jobs removed
- [ ] **TC-RUJ-02** Count returned accurately

---

## 🛠️ **4. Service Layer Methods**

---

### **4.1 determineFileTypeAndEndpoint()**

- [ ] **TC-DFT-01** JPG returns `/api/sendImage` + `image/jpeg`
- [ ] **TC-DFT-02** MP4 returns `/api/sendVideo` + `video/mp4`
- [ ] **TC-DFT-03** PDF returns `/api/sendFile` + `application/pdf`
- [ ] **TC-DFT-04** Unknown extension returns `/api/sendFile`

---

### **4.2 calculatePriority()**

- [ ] **TC-CP-01** < 1 min delay → priority 1
- [ ] **TC-CP-02** < 5 min delay → priority 3
- [ ] **TC-CP-03** < 1 hour delay → priority 5
- [ ] **TC-CP-04** > 1 hour delay → priority 7

---

### **4.3 handleRecurringMessage()**

- [ ] **TC-HRM-01** Valid interval re-queues job
- [ ] **TC-HRM-02** Invalid interval logs error
- [ ] **TC-HRM-03** repeatingTimes null → infinite
- [ ] **TC-HRM-04** New job ID format correct

---

---

**Last Updated:** December 5, 2025

