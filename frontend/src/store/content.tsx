import { createContext, useState, useContext } from 'react';
import { SiteContent } from '../domain/types';
import { getContent, saveContent } from '../services/content-repository';
const ContentContext = createContext<any>(null);
export const ContentProvider = ({ children }: any) => {
  const [content, setContent] = useState<SiteContent>(getContent());
  const update = (newContent: SiteContent) => { setContent(newContent); saveContent(newContent); };
  return <ContentContext.Provider value={{ content, update }}>{children}</ContentContext.Provider>;
};
export const useContent = () => useContext(ContentContext);