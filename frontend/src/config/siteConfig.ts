export const siteConfig = {
  empresa: {
    nome: 'Posto Via 14',
    razaoSocial: 'Auto Posto Imperador Rio Claro LTDA',
    cnpj: '03.634.500/0001-73',
  },
  contato: {
    telefone: '(19) 3524-0264',
    telefoneLink: '551935240264',
    whatsapp: '(19) 98922-3744',
    whatsappLink: '5519989223744',
    email: 'contato@postovia14.com.br',
  },
  endereco: {
    texto: 'Rua 14, 3.156, Alto do Santana, Rio Claro/SP',
    cidade: 'Rio Claro',
    estado: 'SP',
  },
  redes: {
    mensagemWhatsapp: 'Olá, vim pelo site do Posto Via 14.',
  },
};

export type SiteConfig = typeof siteConfig;
