import { siteConfig } from './siteConfig';

export const branding = {
  name: siteConfig.empresa.nome,
  socialName: siteConfig.empresa.razaoSocial,
  phone: siteConfig.contato.telefone,
  address: siteConfig.endereco.texto,
  cnpj: siteConfig.empresa.cnpj,
};
