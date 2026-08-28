import type { Block } from './blocks';
export interface Workflow {
  id: string;
  userId?: string;
  name: string;
  description: string;
  longDescription?: string;
  category: string;
  creator: string;
  rating: number;
  reviews: number;
  installs: number;
  isPremium: boolean;
  price?: number;
  icon: string;
  features: string[];
  exampleOutput?: string;
  trending?: boolean;
  new?: boolean;
  createdAt?: string;
  templateData?: {
    blocks: Block[];
  };
}

export const WORKFLOWS: Workflow[] = [];

export const CATEGORIES = [
  'All',
  'Marketing',
  'Content Creation',
  'Coding',
  'Productivity',
  'Social Media',
  'Business Automation',
  'AI Research',
  'Data Analysis',
  'Shopping',
  'Lifestyle',
  'Finance',
  'Education',
  'Personal Assistant',
  'Customer Support',
  'General Tool'
];
