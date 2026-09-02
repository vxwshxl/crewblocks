'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { X, Puzzle, Download, FolderDown, Chrome, CheckCircle2 } from 'lucide-react';

export default function DownloadExtensionBtn() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button 
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 bg-[#B7F34C] text-[#0A0A0A] px-4 py-2.5 rounded-full text-sm font-semibold mx-auto cursor-pointer border-none transition-all hover:bg-[#A6E63F] active:scale-95 shadow-sm whitespace-nowrap"
      >
        <Image src="/192px.svg" width={20} height={20} alt="Chrome Extension" className="shrink-0 object-contain w-5 h-5" style={{ width: '20px', height: '20px' }} />
        Download Extension
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center text-left">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

          {/* Modal */}
          <div className="relative bg-card border border-border rounded-none shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-none bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Puzzle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Download CrewAgent</h2>
                  <p className="text-xs text-muted-foreground">Chrome Browser Extension</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-full border border-border bg-transparent hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5">
              {/* Download Button */}
              <a
                href="/BlockAgent.zip"
                download="BlockAgent.zip"
                className="flex items-center justify-center gap-3 w-full bg-primary text-primary-foreground font-semibold py-3.5 px-6 rounded-full transition-all hover:opacity-90 active:scale-[0.98]"
              >
                <Download className="w-5 h-5" />
                Download BlockAgent.zip
              </a>

              <p className="text-xs text-muted-foreground text-center">
                Downloads the <code className="bg-white/10 px-1.5 py-0.5 rounded-none text-white/80">BlockAgent</code> extension folder as a ZIP file
              </p>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Installation Steps</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Steps */}
              <div className="space-y-3">
                {[
                  {
                    step: 1,
                    icon: <FolderDown className="w-4 h-4" />,
                    title: 'Download & Extract',
                    desc: (
                      <>
                        Click the download button above to get the ZIP file. <strong className="text-white">Extract/unzip</strong> it to a folder on your computer.
                      </>
                    ),
                  },
                  {
                    step: 2,
                    icon: <Chrome className="w-4 h-4" />,
                    title: 'Open Chrome Extensions',
                    desc: (
                      <>
                        Navigate to{' '}
                        <code className="bg-white/10 px-1.5 py-0.5 rounded-none text-white/80 text-xs">chrome://extensions</code>{' '}
                        in your browser and enable <strong className="text-white">Developer mode</strong>.
                      </>
                    ),
                  },
                  {
                    step: 3,
                    icon: <Puzzle className="w-4 h-4" />,
                    title: 'Load the extension',
                    desc: (
                      <>
                        Click <strong className="text-white">Load unpacked</strong> and select the extracted <code className="bg-white/10 px-1.5 py-0.5 rounded-none text-white/80 text-xs">BlockAgent</code> folder.
                      </>
                    ),
                  },
                  {
                    step: 4,
                    icon: <CheckCircle2 className="w-4 h-4" />,
                    title: 'Pin & Use',
                    desc: (
                      <>
                        Pin the CrewAgent extension from the puzzle icon in Chrome&apos;s toolbar. Click it on any page to open the sidebar!
                      </>
                    ),
                  },
                ].map((item) => (
                  <div key={item.step} className="flex gap-3 p-3 rounded-none bg-white/3 border border-white/6">
                    <div className="shrink-0 w-8 h-8 rounded-none bg-white/8 text-white flex items-center justify-center text-sm font-bold">
                      {item.step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-muted-foreground">{item.icon}</span>
                        <h4 className="text-sm font-semibold text-white">{item.title}</h4>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer note */}
              <div className="bg-white/3 border border-white/6 rounded-none p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-white">💡 Tip:</strong> Make sure your CrewBlocks dashboard is running (locally or deployed) so the extension can connect to your configured chatflows and API keys.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
