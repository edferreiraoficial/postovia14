import { siteConfig } from '../../config/siteConfig';

export const ContactPage = () => (
  <>
    <section className="page-hero contact-hero">
      <div className="container page-hero__content">
        <span className="section-kicker">Contato</span>
        <h1>Fale com o {siteConfig.empresa.nome}.</h1>
        <p>Estamos à disposição para atender você por telefone, WhatsApp ou e-mail.</p>
      </div>
    </section>

    <section className="container content-section contact-grid">
      <article className="contact-card">
        <span>📍</span>
        <h2>Endereço</h2>
        <p>{siteConfig.endereco.texto}</p>
      </article>
      <article className="contact-card">
        <span>☎️</span>
        <h2>Telefone</h2>
        <p><a href={`tel:+${siteConfig.contato.telefoneLink}`}>{siteConfig.contato.telefone}</a></p>
      </article>
      <article className="contact-card">
        <span>✉️</span>
        <h2>E-mail</h2>
        <p><a href={`mailto:${siteConfig.contato.email}`}>{siteConfig.contato.email}</a></p>
      </article>
      <article className="contact-card contact-card--whatsapp">
        <span>💬</span>
        <h2>WhatsApp</h2>
        <p><a href={`https://wa.me/${siteConfig.contato.whatsappLink}`} target="_blank" rel="noreferrer">{siteConfig.contato.whatsapp}</a></p>
      </article>
    </section>
  </>
);
