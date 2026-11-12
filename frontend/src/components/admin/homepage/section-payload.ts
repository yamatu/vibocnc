export type SectionPayload = {
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  button_text: string;
  button_url: string;
  sort_order: number;
  is_active: boolean;
  data?: unknown;
};
