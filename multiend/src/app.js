import './app.css';
import { LanguageProvider } from './i18n/LanguageProvider.jsx';

// Root app shell — provides the i18n context (lang + t translator) to every page,
// mirroring how the web entry wraps <App/> in <LanguageProvider/>.
function App({ children }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

export default App;
