import './app.css';
import { LanguageProvider } from './i18n/LanguageProvider.jsx';
import { CLOUDBASE_ENV_ID, USE_CLOUDBASE_CONTAINER } from './config.js';

if (
  USE_CLOUDBASE_CONTAINER &&
  typeof wx !== 'undefined' &&
  wx.cloud &&
  typeof wx.cloud.init === 'function'
) {
  wx.cloud.init({
    env: CLOUDBASE_ENV_ID,
    traceUser: true,
  });
}

// Root app shell — provides the i18n context (lang + t translator) to every page,
// mirroring how the web entry wraps <App/> in <LanguageProvider/>.
function App({ children }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

export default App;
