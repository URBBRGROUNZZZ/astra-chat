import { FileText, X } from 'lucide-react';
import type { Attachment } from './attachments';

export default function AttachmentList({ files, onRemove }: { files: Attachment[]; onRemove?: (id: string) => void }) {
  return <div className={`attachments ${onRemove ? 'pending-attachments' : 'sent-attachments'}`} aria-label={onRemove ? '待发送附件' : '已发送附件'}>
    {files.map(file => <div className={`attachment attachment-${file.kind}`} key={file.id} title={file.name}>
      {file.kind === 'image' ? <img src={file.data} alt={file.name} /> : <FileText size={20} aria-hidden="true" />}
      <span className="attachment-name">{file.name}</span>
      {onRemove && <button type="button" aria-label={`移除 ${file.name}`} className="remove-attachment" onClick={() => onRemove(file.id)}><X size={14} /></button>}
    </div>)}
  </div>;
}
