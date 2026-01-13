import React, { useState, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, Globe, Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const languages = [
  'Turkish', 'English', 'Spanish', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Chinese', 'Arabic', 'Russian', 'Portuguese'
];

const steps = [
  { id: 'extracting', label: 'Extracting Text' },
  { id: 'translating', label: 'AI Translation' },
  { id: 'generating', label: 'Reconstructing File' }
];

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('Turkish');
  const [isTranslating, setIsTranslating] = useState(false);
  const [status, setStatus] = useState<string>('idle'); // idle, extracting, translating, generating, completed, error
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
      if (!validTypes.includes(selectedFile.type) && !selectedFile.name.endsWith('.pptx')) {
        setError('Please upload a PDF or PPTX file.');
        return;
      }
      setFile(selectedFile);
      setError(null);
      setDownloadUrl(null);
    }
  };

  const handleTranslate = async () => {
    if (!file) return;

    setIsTranslating(true);
    setError(null);
    setDownloadUrl(null);
    setStatusMessage('Preparing upload...');

    const jobId = Date.now().toString();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('targetLanguage', targetLanguage);
    formData.append('jobId', jobId);

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

    // Initial status check to start the loop
    const statusInterval = setInterval(async () => {
      try {
        const statusRes = await axios.get(`${API_URL}/api/status/${jobId}`);
        setStatusMessage(statusRes.data.message);
        setStatus(statusRes.data.status);
        if (statusRes.data.status === 'completed' || statusRes.data.status === 'error') {
          clearInterval(statusInterval);
        }
      } catch (e) {
        console.error('Status fetching error', e);
      }
    }, 800);

    try {
      const response = await axios.post(`${API_URL}/api/translate`, formData, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      setDownloadUrl(url);
    } catch (err: any) {
      clearInterval(statusInterval);
      console.error(err);
      if (err.response?.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          setError(reader.result as string);
        };
        reader.readAsText(err.response.data);
      } else if (err.response) {
        // The server responded with a status code that falls out of the range of 2xx
        setError(err.response.data || 'Server error. Please check backend logs.');
      } else if (err.request) {
        // The request was made but no response was received
        setError('Cannot connect to the server. If you are on Netlify, did you deploy your backend? If local, is the backend running?');
      } else {
        // Something happened in setting up the request that triggered an Error
        setError(err.message || 'An unexpected error occurred.');
      }
    } finally {
      setIsTranslating(false);
      setStatusMessage(null);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="app-container">
      <div className="shape shape-1"></div>
      <div className="shape shape-2"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card"
      >
        <h1 className="title">Academic Document Translator</h1>
        <p className="subtitle">High-fidelity formal translation for PDF & PPTX</p>
        <p className="subtitle" style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '-0.5rem' }}>
          Umut Aksoy tarafından sadece İşletim Sistemleri slaytı çevirsin diye yazılmıştır.
        </p>

        <div className="upload-section">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept=".pdf,.pptx"
          />

          <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="upload-zone"
            onClick={triggerFileInput}
          >
            {file ? (
              <>
                <FileText className="upload-icon" />
                <div>
                  <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{file.name}</h3>
                  <p className="text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB • {file.name.endsWith('.pptx') ? 'PowerPoint' : 'PDF'}</p>
                </div>
              </>
            ) : (
              <>
                <Upload className="upload-icon" />
                <div>
                  <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Upload PDF or PPTX</h3>
                  <p className="text-muted">or drag and drop your file here</p>
                </div>
              </>
            )}
          </motion.div>

          <AnimatePresence>
            {isTranslating && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="progress-container"
                style={{ marginTop: '2rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  {steps.map((step, idx) => {
                    const isActive = status === step.id;
                    const isDone = steps.findIndex(s => s.id === status) > idx || status === 'completed';
                    return (
                      <div key={step.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: isActive || isDone ? 1 : 0.4 }}>
                        <div style={{
                          width: '30px',
                          height: '30px',
                          borderRadius: '50%',
                          background: isDone ? '#34d399' : isActive ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginBottom: '0.5rem',
                          transition: 'all 0.3s ease',
                          boxShadow: isActive ? '0 0 15px var(--primary)' : 'none'
                        }}>
                          {isDone ? (
                            <CheckCircle size={16} />
                          ) : isActive ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            idx + 1
                          )}
                        </div>
                        <span style={{ fontSize: '0.75rem' }}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ textAlign: 'center', color: 'var(--primary)', fontWeight: 500 }}>
                  {statusMessage}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="file-info"
                style={{ color: '#ef4444' }}
              >
                <AlertCircle size={18} /> {error}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="controls">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Globe size={20} className="text-muted" />
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                disabled={isTranslating}
              >
                {languages.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>

            <button
              className="btn-primary"
              onClick={handleTranslate}
              disabled={!file || isTranslating}
            >
              {isTranslating ? (
                <>
                  <Loader2 className="animate-spin" />
                  {statusMessage || 'Translating...'}
                </>
              ) : (
                <>
                  Translate Now
                </>
              )}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {downloadUrl && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card"
              style={{ padding: '2rem', marginTop: '2rem', background: 'rgba(52, 211, 153, 0.1)', borderColor: 'rgba(52, 211, 153, 0.2)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <CheckCircle style={{ color: '#34d399' }} />
                  <div>
                    <h4 style={{ margin: 0 }}>Translation Complete!</h4>
                    <p className="text-muted" style={{ fontSize: '0.9rem' }}>Your translated document is ready for download.</p>
                  </div>
                </div>
                <a
                  href={downloadUrl}
                  download={`translated_${file?.name}`}
                  className="btn-primary"
                  style={{ background: '#34d399' }}
                >
                  <Download size={20} /> Download Result
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <footer style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '2rem' }}>
        Professional Academic Translation System
      </footer>
    </div>
  );
}

export default App;
