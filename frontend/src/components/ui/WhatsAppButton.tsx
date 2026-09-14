'use client';

import { useState } from 'react';

interface WhatsAppButtonProps {
  phoneNumber?: string;
  message?: string;
  position?: 'bottom-right' | 'bottom-left';
}

export default function WhatsAppButton({
  phoneNumber = '8613348028050',
  message = 'Hello, I am interested in your industrial automation parts and repair support!',
  position = 'bottom-right'
}: WhatsAppButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://web.whatsapp.com/send?phone=${phoneNumber}&text=${encodedMessage}`;

    // 在移动设备上使用 wa.me，在桌面上使用 web.whatsapp.com
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const finalUrl = isMobile
      ? `https://wa.me/${phoneNumber}?text=${encodedMessage}`
      : whatsappUrl;

    window.open(finalUrl, '_blank');
  };

  const positionClasses = position === 'bottom-right'
    ? 'right-3 bottom-[calc(env(safe-area-inset-bottom)+1rem)] sm:right-6 sm:bottom-6'
    : 'left-3 bottom-[calc(env(safe-area-inset-bottom)+1rem)] sm:left-6 sm:bottom-6';

  return (
    <>
      {/* 浮动按钮 */}
      <div className={`fixed ${positionClasses} z-50`}>
        <button
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="group relative flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] shadow-2xl transition-all duration-300 hover:scale-110 hover:bg-[#20BA5A] active:scale-95 sm:h-16 sm:w-16"
          aria-label="Chat on WhatsApp"
        >
          {/* WhatsApp Icon */}
          <svg
            className="h-7 w-7 text-white sm:h-9 sm:w-9"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
          </svg>

          {/* 脉冲动画 */}
          <span className="absolute inset-0 rounded-full bg-[#25D366] opacity-75 animate-ping"></span>
        </button>

        {/* 悬停提示文本 */}
        {isHovered && (
          <div className="absolute right-20 bottom-4 bg-white px-4 py-2 rounded-lg shadow-lg whitespace-nowrap animate-fadeIn">
            <p className="text-sm font-medium text-gray-900">Chat with us on WhatsApp!</p>
            <div className="absolute right-[-8px] top-1/2 transform -translate-y-1/2">
              <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[8px] border-l-white border-b-[8px] border-b-transparent"></div>
            </div>
          </div>
        )}
      </div>

      {/* 添加动画样式 */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateX(10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
