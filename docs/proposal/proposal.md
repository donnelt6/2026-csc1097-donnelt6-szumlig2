# School of Computing &mdash; Year 4 Project Proposal Form

## SECTION A

|                     |                   |
|---------------------|-------------------|
|Project Title:       | Mindfull            |
|Student 1 Name:      | Tadhg Donnelly            |
|Student 1 ID:        | 22480084            |
|Student 2 Name:      | Gavin Szumlicki            |
|Student 2 ID:        | xxxxxx            |
|Project Supervisor:  | Boualem Benatallah           |

## SECTION B

### Introduction

Individuals and teams today manage an ever-expanding mix of digital content. They juggle  PDFs, meeting notes, webpages, and recordings without a shared environment to surface what matters quickly. Important details such as due dates or action items remain buried inside long documents. Personal notes, recipes, and reminders often get lost in long documents or scattered across apps, making them easy to lose or forget. Existing tools either focus on personal note taking or heavyweight enterprise knowledge bases. This project proposes a web application, Mindfull, that unifies document ingestion, AI-assisted search, and proactive reminders into a collaborative workspace suitable for everyday use and in professional documentation workflows.

### Outline

Mindfull will allow users to upload files and share links, with the stretch goal of supporting YouTube videos that can be transcribed. Each item enters an ingestion pipeline that extracts text, chunks it for semantic search, and stores both original and processed representations. Users can create shared "minds" to organise sources and collaborate. A conversational interface lets them query either their uploaded content alone or combine it with the model's broader knowledge. When the system detects deadlines or action items, it gives the user the option to create reminders that trigger in-app and email notifications. The application is built with usability in mind, ensuring that managing and retrieving information feels simple and natural.

In terms of collaboration, the application organises content inside shared minds. Mind owners can invite teammates, assign viewer or editor permissions, and review an activity history of uploads, reminders, and conversations. The ingestion pipeline supports a variety of formats including PDFs, DOCX, text files, Markdown, and webpages and processes them in the background. Each upload is stored in Supabase, passed to a background worker for conversion or transcription, and then normalised into structured text with page and timestamp metadata. The text is then split into manageable segments, embedded for semantic search, and recorded alongside the original source so users can always trace answers back to where they came from. 

### Background

The idea grew out of our internship experiences, where we saw firsthand how our teams had centralised documentation but still struggled to locate specific details quickly.During onboarding in particular, we often found ourselves hunting through lengthy pages or chat threads for information that should have been easy to surface—things like procedures, timelines, or even just the right contact person. A tool like Mindfull would have filled a clear gap by allowing us to search conversationally across documents and receive answers directly tied back to their sources, saving both time and frustration. It would also have helped our teams stay aligned by flagging deadlines and action items from meetings automatically, reducing the risk of things slipping through the cracks in a busy environment. 

During his internship, Tadhg experimented with addressing this problem by building a simple chatbot connected to his team’s Confluence documentation. The prototype was created with Langflow and showed the potential of such an approach but also revealed its limitations. This highlighted how much more benificial a powerful and dedicated system could be. With recent advances in retrieval-augmented generation (RAG) and LLMs in general, it is  practical to deliver that kind of solution, blending personal knowledge bases with an AI assistant that is genuinely useful in day-to-day life and work.

### Achievements

The completed system will provide a platform where users can upload PDFs, DOCX, TXT, Markdown, and webpages. A stretch goal is to support YouTube links, which would be transcribed and ingested in the same way as documents. Uploaded content is organised inside  “minds,” where owners can choose to invite collaborators to contribute to a common knowledge base or keep it personal. A chat interface allows users to query their uploaded content directly or combine it with the model’s broader knowledge, with responses always citing the underlying sources. The system will also detect due dates and obligations in ingested content and prompt users to create reminders, which trigger in-app and email notifications.

The completed system will:
- Support uploads of PDFs, DOCX, TXT, Markdown, webpages, and the stretch goal of YouTube links. 
- Maintain shared minds where owners invite collaborators to work from a common knowledge base.
- Provide a chat interface with a toggle to restrict answers to mind content or expand to the model's general knowledge, always presenting citations.
- Detect due dates and action items in ingested content, prompting optional reminders and deliver optional notifications by email and within the app.

Primary users include individuals and small groups managing personal or professional projects. For example, an individual could use Mindfull to keep track of household documents, recipes, or personal research notes, while a project team might rely on it to consolidate meeting notes and planning files. In both cases, the goal is to reduce the time lost searching across multiple apps and formats by providing a single place where important details can be recalled quickly and reliably.


### Justification

Mindfull will be useful in any context where people manage multiple sources of information but lack a single environment to bring them together. Individuals often deal with personal projects that span recipes, bills and budgeting, research notes, or household records, while small groups need to coordinate around contracts, meeting notes, or shared planning documents. In both cases, valuable details are easy to overlook when spread across emails, cloud storage, local storage and chat threads.

The system helps by unifying these sources, enabling users to ask natural-language questions and receive cited answers from their own content. This reduces the time lost searching or re-reading and gives confidence that nothing important is missed. The ability to detect deadlines and obligations further adds to its usefulness, nudging users with reminders before tasks slip through the cracks.

Mindfull is particularly valuable in project-based settings, whether personal or a collaborative effort—where scattered information leads to delays or miscommunication. By providing one workspace for ingestion, retrieval, and reminders, it offers a practical way to stay organised.

### Programming language(s)

- **Javascript and Typescript** - for the Next.js frontend.
- **HTLM/CSS** - User interface markup and styling.
- **Python** - Backend, FastAPI services and NLP pipelines.

### Programming tools / Tech stack

- Next.js with Tailwind CSS for the frontend.
- FastAPI for backend APIs, with Celery for handling workers that deal with ingestion and reminder jobs.
- Supabase Postgres, Supabase Auth, and Supabase Storage.
- OpenAI GPT-5 mini for conversational responses.
- Railway for hosting, GitHub Actions for CI/CD.

### Hardware

- Personal laptops/desktops for development
- Lab computers

### Learning Challenges

**AI and Retrieval**
- Retrieval-augmented prompts with consistent citations.
- Evaluation methods for mind-only and global answers.

**Data and Security**
- Ensuring data integrity, security and availability.
- Labeling data accurately.

**Ingestion and Automation**
- Parsing long PDFs and webpages.
- Scheduling reminders across background jobs, email, and in-app alerts.

**Frontend**
- Designing a clear and effective UI.
- Implementing drag and drop file organisation.

### Breakdown of work

Both students will collaborate on the overall architecture design, documentation and in orchestration of comprehensive user testing.

#### Student 1 (Tadhg Donnelly) -- Backend, AI, and Infrastructure
- Design database schema and Supabase policies for users, minds, sources, chats, and reminders.
- Implement FastAPI services for uploads, ingestion orchestration, retrieval, chat responses, and reminder management.
- Build Celery worker pipelines for parsing, transcription, embedding generation, and reminder scheduling.
- Integrate AI services using APIs and manage response formatting for scoped answers with many citations.
- Lead backend test strategy, including unit and integration testing suites.

#### Student 2 (Gavin Szumlicki) -- Frontend, UX, and Collaboration features
- Design and implementation of the User Interface.
- Implement authentication flows, dashboard, and mind management interfaces in Next.js.
- Develop the upload experience with status badges and error handling.
- Build the conversational interface, including scope toggles, streaming responses, and citation highlighting.
- Create reminder prompts, notifications centre, and analytics views for mind owners.


### Risk Register

| Description | Likelyhood | Severity | Mitigation |
|-------------|------------|----------|------------|
| Variability in document formats causes ingestion failures | Medium | High | Implement fallback plain-text extraction, add automated regression tests, and expose retry tooling for users. |
| Web scraping blocked by site policies | Medium | Medium | Respect robots.txt and provide manual upload fallback |
| Supabase outage impacts data access | Low | High | Enable automatic retries, maintain regular backups. |
| Users upload very large files exceeding limits | Medium | Medium | Set size caps, provide clear error messages, and suggest splitting documents. |
| Embedding generation fails due to API downtime | Medium | Medium | Queue requests, retry later, and surface placeholders until recovery. |


#### Student 1

> *Student 1 should complete this section.*

#### Student 2

> *Student 2 should complete this section.*

## Example

> Example: Here's how you can include images in markdown documents...

<!-- Basically, just use HTML! -->

<p align="center">
  <img src="./res/cat.png" width="300px">
</p>

