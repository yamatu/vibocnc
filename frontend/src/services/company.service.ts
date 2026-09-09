import api from '@/lib/api';

export interface CompanyProfileRequest {
  company_name?: string;
  company_subtitle?: string;
  establishment_year?: string;
  location?: string;
  workshop_size?: string;
  description_1?: string;
  description_2?: string;
  achievement?: string;
  stats?: unknown[];
  expertise?: string[];
  workshop_facilities?: unknown[];
}

const CompanyService = {
  async getProfile() {
    return api.get('/public/company-profile');
  },
  async updateProfile(data: CompanyProfileRequest) {
    return api.post('/admin/company-profile', data);
  },
};

export default CompanyService;
