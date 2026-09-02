'use client';

import React from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm duration-200" 
        onClick={!loading ? onCancel : undefined} 
      />
      
      <div className="relative w-full max-w-[400px] bg-card border border-border rounded-2xl overflow-hidden shadow-2xl duration-200 animate-in fade-in zoom-in-95">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${destructive ? 'bg-red-500/10 border-red-500/20' : 'bg-primary/10 border-primary/20'}`}>
              <AlertTriangle className={`w-5 h-5 ${destructive ? 'text-red-500' : 'text-primary'}`} />
            </div>
            {!loading && (
              <button 
                onClick={onCancel}
                className="p-1.5 text-zinc-500 hover:text-white transition-colors border border-transparent hover:bg-white/5 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
          <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
            {description}
          </p>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/5">
            <Button
              className="px-4 h-10 bg-transparent hover:bg-white/5 text-white border border-border rounded-lg text-sm font-semibold"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelText}
            </Button>
            <Button
              className={`px-4 h-10 rounded-lg text-sm font-semibold flex items-center gap-2 ${
                destructive 
                  ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20' 
                  : 'bg-primary hover:bg-[#A6E63F] text-primary-foreground shadow-lg shadow-primary/20'
              }`}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
