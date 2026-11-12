import { apiClient } from '@/lib/api';
import { HomepageContent } from '@/types';

export interface HomepageContentRequest {
  section_key: string;
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  button_text: string;
  button_url: string;
  data?: unknown;
  sort_order: number;
  is_active: boolean;
}

export interface HomepageSection {
  key: string;
  name: string;
  description: string;
}

export class HomepageService {
  // Get homepage contents (public). Backend returns raw array (no APIResponse wrapper)
  static async getHomepageContents(): Promise<HomepageContent[]> {
    const response = await apiClient.get<HomepageContent[]>(
      '/public/homepage-content'
    );
    return response.data;
  }

  // Get homepage content by section (public)
  static async getHomepageContentBySection(sectionKey: string): Promise<HomepageContent> {
    const response = await apiClient.get<HomepageContent>(
      `/public/homepage-content/section/${sectionKey}`
    );
    return response.data;
  }

  // Admin: Get homepage contents
  static async getAdminHomepageContents(): Promise<HomepageContent[]> {
    const response = await apiClient.get<HomepageContent[]>(
      '/admin/homepage-content'
    );
    return response.data;
  }

  // Admin: Get predefined sections (from backend)
  static async getAdminSections(): Promise<HomepageSection[]> {
    const response = await apiClient.get<HomepageSection[]>(
      '/admin/homepage-content/sections'
    );
    return response.data;
  }

  // Admin: Get single homepage content
  static async getAdminHomepageContent(id: number): Promise<HomepageContent> {
    const response = await apiClient.get<HomepageContent>(
      `/admin/homepage-content/${id}`
    );
    return response.data;
  }

  // Admin: Create homepage content
  static async createHomepageContent(contentData: HomepageContentRequest): Promise<HomepageContent> {
    const response = await apiClient.post<HomepageContent>(
      '/admin/homepage-content',
      contentData
    );
    return response.data;
  }

  // Admin: Update homepage content
  static async updateHomepageContent(id: number, contentData: Partial<HomepageContentRequest>): Promise<HomepageContent> {
    const response = await apiClient.put<HomepageContent>(
      `/admin/homepage-content/${id}`,
      contentData
    );
    return response.data;
  }

  // Admin: Delete a custom homepage content section
  static async deleteHomepageContent(id: number): Promise<void> {
    await apiClient.delete(`/admin/homepage-content/${id}`);
  }

  // Admin: Upsert by section key (preferred for the visual editor)
  static async upsertAdminBySectionKey(sectionKey: string, contentData: Partial<HomepageContentRequest>): Promise<HomepageContent> {
    const response = await apiClient.put<HomepageContent>(
      `/admin/homepage-content/section/${sectionKey}`,
      contentData
    );
    return response.data;
  }

  // Admin: unsaved visual-editor drafts (only the admin preview reads them)
  static async saveDraft(sectionKey: string, payload: unknown): Promise<void> {
    await apiClient.put(`/admin/homepage-content/drafts/${sectionKey}`, payload);
  }

  static async deleteDraft(sectionKey: string): Promise<void> {
    await apiClient.delete(`/admin/homepage-content/drafts/${sectionKey}`);
  }

  static async clearDrafts(): Promise<void> {
    await apiClient.delete('/admin/homepage-content/drafts');
  }

  // Convenience: Get aggregated content for Admin form
  // Returns { data: { hero_title, hero_subtitle, ... , about_title, ... } }
  static async getContent(): Promise<{ data: Record<string, unknown> }> {
    const contents = await this.getAdminHomepageContents();
    const byKey = Object.fromEntries(contents.map(c => [c.section_key, c]));

    const hero = byKey['hero_section'];
    const about = byKey['about_section'];

    const data = {
      hero_title: hero?.title || '',
      hero_subtitle: hero?.subtitle || '',
      hero_description: hero?.description || '',
      hero_image_url: hero?.image_url || '',
      hero_button_text: hero?.button_text || '',
      hero_button_url: hero?.button_url || '',
      about_title: about?.title || '',
      about_description: about?.description || '',
      about_image_url: about?.image_url || '',
      // Placeholders for future arrays
      features: [],
      stats: [],
    };

    return { data };
  }

  // Convenience: Update aggregated content from Admin form
  static async updateContent(form: Record<string, unknown>): Promise<void> {
    const existing = await this.getAdminHomepageContents();
    const byKey: Record<string, HomepageContent | undefined> = Object.fromEntries(existing.map(c => [c.section_key, c]));

    const textValue = (value: unknown) => value == null ? '' : String(value);

    // Map hero_section
    const heroPayload: HomepageContentRequest = {
      section_key: 'hero_section',
      title: textValue(form.hero_title),
      subtitle: textValue(form.hero_subtitle),
      description: textValue(form.hero_description),
      image_url: textValue(form.hero_image_url),
      button_text: textValue(form.hero_button_text),
      button_url: textValue(form.hero_button_url),
      sort_order: 1,
      is_active: true,
    };

    // Map about_section
    const aboutPayload: HomepageContentRequest = {
      section_key: 'about_section',
      title: textValue(form.about_title),
      subtitle: '',
      description: textValue(form.about_description),
      image_url: textValue(form.about_image_url),
      button_text: '',
      button_url: '',
      sort_order: 2,
      is_active: true,
    };

    if (byKey['hero_section']) {
      await this.updateHomepageContent(byKey['hero_section']!.id, heroPayload);
    } else {
      await this.createHomepageContent(heroPayload);
    }

    if (byKey['about_section']) {
      await this.updateHomepageContent(byKey['about_section']!.id, aboutPayload);
    } else {
      await this.createHomepageContent(aboutPayload);
    }
  }

  // Get predefined homepage sections
  static getPredefinedSections(): HomepageSection[] {
    return [
      { key: 'hero_section', name: 'Hero Section', description: 'Main banner section at the top of the homepage' },
      { key: 'brands_section', name: 'Brands We Supply', description: 'Multi-brand automation parts supply grid' },
      { key: 'repair_capabilities', name: 'Repair Capabilities', description: 'Repairable equipment types and typical faults' },
      { key: 'home_blog', name: 'Featured Blog Articles', description: 'Published Blog articles marked as Featured' },
      { key: 'workshop_facility', name: 'Workshop Facility', description: '3,500 sqm inspection and service facility section' },
      { key: 'workshop_overview', name: 'Workshop Overview', description: 'Modern Facility overview' },
      { key: 'inventory_management', name: 'Inventory Management', description: 'Organized storage information' },
      { key: 'quality_control', name: 'Quality Control', description: 'Quality assurance information' },
      { key: 'about_section', name: 'About Section', description: 'Company information section' },
      { key: 'services_section', name: 'Services Section', description: 'Services overview section' },
      { key: 'contact_section', name: 'Contact Section', description: 'Contact information section' },
    ];
  }

  // Get section by key
  static getSectionByKey(key: string): HomepageSection | undefined {
    return this.getPredefinedSections().find(section => section.key === key);
  }

  // Get section name
  static getSectionName(key: string): string {
    const section = this.getSectionByKey(key);
    return section?.name || key;
  }

  // Get content by section key
  static async getContentBySection(sectionKey: string): Promise<HomepageContent | null> {
    try {
      return await this.getHomepageContentBySection(sectionKey);
    } catch {
      return null;
    }
  }

  // Helper: Sort content by sort order
  static sortContent(contents: HomepageContent[]): HomepageContent[] {
    return [...contents].sort((a, b) => a.sort_order - b.sort_order);
  }
}

export default HomepageService;
