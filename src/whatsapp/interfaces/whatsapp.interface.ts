export interface WhatsAppWebhookPayload {
  object: string;
  entry?: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes?: WhatsAppChange[];
}

export interface WhatsAppChange {
  field: string;
  value: WhatsAppChangeValue;
}

export interface WhatsAppChangeValue {
  messaging_product: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    profile?: {
      name?: string;
    };
    wa_id: string;
  }>;
  messages?: WhatsAppMessage[];
  statuses?: any[];
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'audio' | 'voice' | string;
  text?: {
    body: string;
  };
  audio?: {
    id: string;
    mime_type: string;
    sha256?: string;
    voice?: boolean;
  };
  voice?: {
    id: string;
    mime_type: string;
    sha256?: string;
  };
}

export interface StructuredTaskResult {
  title: string;
  body: string;
}

export interface WhatsAppProcessingResult {
  processed: number;
  createdTasks: Array<{
    title: string;
    itemId: string;
    sender: string;
  }>;
}
