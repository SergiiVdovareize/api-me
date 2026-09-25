export interface DateSuggestion {
  title: string;
  description: string;
  category: 'romantic' | 'active' | 'creative' | 'relax' | 'food' | 'culture' | string;
  estimatedCost: 'free' | 'budget' | 'moderate' | 'premium' | string;
}

export interface DateSuggestionsResponse {
  success: boolean;
  letter: string;
  suggestions: DateSuggestion[];
}
