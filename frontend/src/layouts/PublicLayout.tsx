import { Link, Outlet } from 'react-router-dom';
import { siteConfig } from '../config/siteConfig';

const whatsappMessage = encodeURIComponent(siteConfig.redes.mensagemWhatsapp);

export default function PublicLayout() {
  return (
    <div className="public-layout">
      <header className="header">
        <Link className="logo" to="/">{siteConfig.empresa.nome}</Link>
        <nav className="nav">
          <Link to="/">Home</Link>
          <Link to="/sobre">Sobre</Link>
          <Link to="/produtos">Produtos</Link>
          <Link to="/contato">Contato</Link>
          <Link to="/admin/login">Admin</Link>
        </nav>
      </header>
      <main><Outlet /></main>
      <a
        className="whatsapp-float"
        href={`https://wa.me/${siteConfig.contato.whatsappLink}?text=${whatsappMessage}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`Falar com o ${siteConfig.empresa.nome} pelo WhatsApp`}
      >
        <span>☎</span>
        <strong>WhatsApp</strong>
      </a>
      <footer className="footer">
        <strong>{siteConfig.empresa.nome}</strong><br />
        {siteConfig.endereco.texto} · {siteConfig.contato.telefone}<br />
        WhatsApp: {siteConfig.contato.whatsapp}<br />
        CNPJ: {siteConfig.empresa.cnpj}
      </footer>
    </div>
  );
}
