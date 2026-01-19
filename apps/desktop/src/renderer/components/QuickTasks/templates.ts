import { 
  Folder, 
  FileText, 
  Image, 
  Download, 
  Trash2, 
  Copy, 
  Search,
  Calendar,
  Mail,
  FileSpreadsheet,
  FolderOpen,
  Archive,
  Printer,
  type LucideIcon
} from 'lucide-react';

export interface QuickTask {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: 'organize' | 'documents' | 'photos' | 'email' | 'cleanup';
  categoryLabel: string;
  prompt: string;
  // Human-readable explanation of what this will do
  whatItDoes: string[];
  // Estimated time in friendly format
  estimatedTime: string;
  // Difficulty level for the user
  difficulty: 'easy' | 'medium';
  // Color theme
  color: string;
}

export const QUICK_TASK_TEMPLATES: QuickTask[] = [
  // --- ORGANIZE ---
  {
    id: 'organize-downloads',
    title: 'Clean Up Downloads',
    description: 'Sort your Downloads folder by file type',
    icon: Download,
    category: 'organize',
    categoryLabel: '📁 Organize',
    prompt: 'Look at my Downloads folder and organize the files into subfolders by type: PDFs, Images, Documents, Spreadsheets, and Other. Move each file to the appropriate folder.',
    whatItDoes: [
      'Creates folders for different file types',
      'Moves PDFs to a "PDFs" folder',
      'Moves images to a "Images" folder',
      'Moves Word/text files to "Documents"',
      'Keeps your Downloads tidy and organized'
    ],
    estimatedTime: '1-2 minutes',
    difficulty: 'easy',
    color: 'blue'
  },
  {
    id: 'organize-desktop',
    title: 'Tidy Up Desktop',
    description: 'Organize scattered files on your desktop',
    icon: FolderOpen,
    category: 'organize',
    categoryLabel: '📁 Organize',
    prompt: 'Help me organize my Desktop. Create folders for different categories (Documents, Images, Work, Personal) and move files from my Desktop into the appropriate folders based on their names and types.',
    whatItDoes: [
      'Creates organized folders on your Desktop',
      'Moves files into appropriate categories',
      'Leaves important shortcuts untouched',
      'Makes your Desktop clean and easy to navigate'
    ],
    estimatedTime: '1-2 minutes',
    difficulty: 'easy',
    color: 'blue'
  },
  {
    id: 'find-duplicates',
    title: 'Find Duplicate Files',
    description: 'Find files that might be duplicates',
    icon: Copy,
    category: 'organize',
    categoryLabel: '📁 Organize',
    prompt: 'Scan my Documents folder and find any files that appear to be duplicates (same name or very similar names). List them for me so I can decide which ones to keep.',
    whatItDoes: [
      'Scans your Documents folder',
      'Finds files with the same or similar names',
      'Shows you what might be duplicates',
      'You decide which to delete - nothing is removed automatically'
    ],
    estimatedTime: '2-3 minutes',
    difficulty: 'easy',
    color: 'blue'
  },

  // --- DOCUMENTS ---
  {
    id: 'summarize-document',
    title: 'Summarize a Document',
    description: 'Get a quick summary of a long document',
    icon: FileText,
    category: 'documents',
    categoryLabel: '📄 Documents',
    prompt: 'I need help summarizing a document. Please ask me which file I want summarized, then read it and give me a clear, simple summary of the main points.',
    whatItDoes: [
      'Reads the document you choose',
      'Identifies the main points',
      'Writes a simple summary for you',
      'Saves you time reading long documents'
    ],
    estimatedTime: '1-2 minutes',
    difficulty: 'easy',
    color: 'green'
  },
  {
    id: 'convert-to-pdf',
    title: 'Convert to PDF',
    description: 'Convert a document to PDF format',
    icon: Printer,
    category: 'documents',
    categoryLabel: '📄 Documents',
    prompt: 'Help me convert a document to PDF. Ask me which file I want to convert, then convert it to PDF format and save it in the same location.',
    whatItDoes: [
      'Takes your Word or text document',
      'Converts it to PDF format',
      'Saves the PDF in the same folder',
      'Original file stays unchanged'
    ],
    estimatedTime: '30 seconds',
    difficulty: 'easy',
    color: 'green'
  },
  {
    id: 'write-thank-you',
    title: 'Write Thank You Note',
    description: 'Draft a polite thank you message',
    icon: Mail,
    category: 'documents',
    categoryLabel: '📄 Documents',
    prompt: 'Help me write a thank you note. Ask me who it\'s for and what I\'m thanking them for, then draft a warm, polite thank you message I can use.',
    whatItDoes: [
      'Asks you about the situation',
      'Writes a thoughtful thank you message',
      'You can copy it to email or a card',
      'Personal and heartfelt tone'
    ],
    estimatedTime: '1 minute',
    difficulty: 'easy',
    color: 'green'
  },

  // --- PHOTOS ---
  {
    id: 'organize-photos',
    title: 'Organize Photos by Date',
    description: 'Sort photos into folders by year and month',
    icon: Image,
    category: 'photos',
    categoryLabel: '📷 Photos',
    prompt: 'Help me organize my photos. Look in my Pictures folder and organize photos into subfolders by year and month (like "2024/January", "2024/February"). Move the photos into the appropriate folders based on when they were taken.',
    whatItDoes: [
      'Looks at your photos in Pictures',
      'Creates folders for each year and month',
      'Moves photos to the right folder',
      'Makes it easy to find photos by date'
    ],
    estimatedTime: '2-5 minutes',
    difficulty: 'easy',
    color: 'purple'
  },
  {
    id: 'find-large-photos',
    title: 'Find Large Photos',
    description: 'Find photos taking up the most space',
    icon: Search,
    category: 'photos',
    categoryLabel: '📷 Photos',
    prompt: 'Find the largest photos in my Pictures folder that are taking up the most storage space. List the top 20 largest image files with their sizes so I can decide if I want to keep them or delete them.',
    whatItDoes: [
      'Scans your Pictures folder',
      'Finds the biggest photo files',
      'Shows you sizes in easy-to-understand format',
      'Helps you free up storage space'
    ],
    estimatedTime: '1-2 minutes',
    difficulty: 'easy',
    color: 'purple'
  },

  // --- CLEANUP ---
  {
    id: 'find-old-files',
    title: 'Find Old Files',
    description: 'Find files you haven\'t used in over a year',
    icon: Calendar,
    category: 'cleanup',
    categoryLabel: '🧹 Cleanup',
    prompt: 'Help me find old files I might not need anymore. Look in my Documents folder and list files that haven\'t been opened or modified in over a year. Just show me the list - don\'t delete anything.',
    whatItDoes: [
      'Scans your Documents folder',
      'Finds files over 1 year old',
      'Shows you a list to review',
      'Nothing is deleted - you stay in control'
    ],
    estimatedTime: '1-2 minutes',
    difficulty: 'easy',
    color: 'orange'
  },
  {
    id: 'empty-trash',
    title: 'Check Trash Size',
    description: 'See how much space your Trash is using',
    icon: Trash2,
    category: 'cleanup',
    categoryLabel: '🧹 Cleanup',
    prompt: 'Check my Trash folder and tell me how much storage space it\'s using. List the largest items in the Trash so I can see what\'s there before deciding to empty it.',
    whatItDoes: [
      'Checks your Trash folder size',
      'Shows what\'s taking up space',
      'Helps you decide if you should empty it',
      'Nothing is deleted automatically'
    ],
    estimatedTime: '30 seconds',
    difficulty: 'easy',
    color: 'orange'
  },
  {
    id: 'archive-old-projects',
    title: 'Archive Old Projects',
    description: 'Compress old project folders to save space',
    icon: Archive,
    category: 'cleanup',
    categoryLabel: '🧹 Cleanup',
    prompt: 'Help me archive old project folders. Ask me which folder contains old projects, then compress each project folder into a zip file to save space. Keep the original folders until I confirm the zips are good.',
    whatItDoes: [
      'Compresses folders into zip files',
      'Keeps originals until you confirm',
      'Saves significant storage space',
      'Easy to unzip if you need them later'
    ],
    estimatedTime: '2-5 minutes',
    difficulty: 'medium',
    color: 'orange'
  },

  // --- EMAIL ---
  {
    id: 'draft-email',
    title: 'Draft a Professional Email',
    description: 'Help writing a work email',
    icon: Mail,
    category: 'email',
    categoryLabel: '✉️ Communication',
    prompt: 'Help me write a professional email. Ask me who it\'s to, what the subject is, and what main points I want to cover. Then draft a clear, professional email I can review and send.',
    whatItDoes: [
      'Asks you about the email details',
      'Writes a professional draft',
      'Includes proper greeting and sign-off',
      'You review and edit before sending'
    ],
    estimatedTime: '1-2 minutes',
    difficulty: 'easy',
    color: 'teal'
  },
  {
    id: 'draft-meeting-notes',
    title: 'Create Meeting Notes',
    description: 'Turn rough notes into organized meeting notes',
    icon: FileSpreadsheet,
    category: 'email',
    categoryLabel: '✉️ Communication',
    prompt: 'Help me create meeting notes. I\'ll tell you the key points from my meeting, and you format them into clear, organized meeting notes with attendees, discussion points, action items, and next steps.',
    whatItDoes: [
      'Takes your rough notes or points',
      'Organizes them professionally',
      'Highlights action items clearly',
      'Creates shareable meeting summary'
    ],
    estimatedTime: '2-3 minutes',
    difficulty: 'easy',
    color: 'teal'
  },
];

export const CATEGORIES = [
  { id: 'all', label: '✨ All Tasks', color: 'gray' },
  { id: 'organize', label: '📁 Organize', color: 'blue' },
  { id: 'documents', label: '📄 Documents', color: 'green' },
  { id: 'photos', label: '📷 Photos', color: 'purple' },
  { id: 'cleanup', label: '🧹 Cleanup', color: 'orange' },
  { id: 'email', label: '✉️ Communication', color: 'teal' },
];
