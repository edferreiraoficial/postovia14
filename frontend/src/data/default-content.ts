import { SiteContent } from '../domain/types';
import { siteConfig } from '../config/siteConfig';

export const defaultContent: SiteContent = {
  heroTitle: 'Qualidade e Confiança em Rio Claro',
  aboutText: 'Posto Via 14, tradição em combustíveis e lubrificantes.',
  products: ['Gasolina Aditivada', 'Etanol', 'Diesel S10', 'Lubrificantes'],
  contactEmail: siteConfig.contato.email,
};
