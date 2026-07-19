export interface LetterState {
  letter: string;
  status: 'available' | 'used' | 'excluded' | 'skipped';
}

export interface BoardMetadata {
  partners?: string[];
  pinHash?: string | null;
}

export interface UpdateBoardDto {
  letters: LetterState[];
  metadata?: BoardMetadata;
}
