'use client';

import { useState, useRef, MouseEvent } from 'react';
import Image from 'next/image';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getProductImageUrlByIndex } from '@/lib/utils';

interface ProductImageViewerProps {
  images: string[] | any[];
  productName: string;
  selectedImageIndex: number;
  onImageChange: (index: number) => void;
  fallbackImage?: string;
  productSku?: string;
  categoryName?: string;
}

function getImageAlt(productName: string, productSku?: string, categoryName?: string, index: number = 0): string {
  const sku = productSku || '';
  const cat = categoryName || 'Industrial Component';
  switch (index) {
    case 0:
      return `${sku} ${productName} - Front View | Vcocnc FANUC Parts`.trim();
    case 1:
      return `${sku} ${productName} - Detail View | ${cat}`.trim();
    default:
      return `${sku} ${productName} - View ${index + 1} | CNC Spare Part`.trim();
  }
}

export default function ProductImageViewer({
  images,
  productName,
  selectedImageIndex,
  onImageChange,
  fallbackImage,
  productSku,
  categoryName
}: ProductImageViewerProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLDivElement>(null);

  const currentImage = images.length > 0
    ? getProductImageUrlByIndex(images, selectedImageIndex)
    : (fallbackImage || '/images/default-product.jpg');

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setMousePosition({ x, y });
  };

  const handleMouseEnter = () => {
    setIsHovering(true);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
  };

  const handleImageChange = (direction: 'prev' | 'next') => {
    if (!images.length) return;
    
    if (direction === 'prev') {
      const newIndex = selectedImageIndex === 0 ? images.length - 1 : selectedImageIndex - 1;
      onImageChange(newIndex);
    } else {
      const newIndex = selectedImageIndex === images.length - 1 ? 0 : selectedImageIndex + 1;
      onImageChange(newIndex);
    }
  };

  return (
    <div className="flex flex-col-reverse">
      {/* Image Thumbnails */}
      {images.length > 1 && (
        <div className="hidden mt-6 w-full max-w-2xl mx-auto sm:block lg:max-w-none">
          <div className="grid grid-cols-4 gap-6">
            {images.map((image: string | any, index: number) => (
              <button
                key={index}
                onClick={() => onImageChange(index)}
                className={`relative h-24 bg-white rounded-md flex items-center justify-center text-sm font-medium uppercase text-gray-900 cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring focus:ring-offset-4 focus:ring-yellow-500 ${
                  index === selectedImageIndex ? 'ring-2 ring-yellow-500' : ''
                }`}
              >
                <span className="sr-only">Image {index + 1}</span>
                <span className="absolute inset-0 rounded-md overflow-hidden">
                  <Image
                    src={getProductImageUrlByIndex(images, index)}
                    alt={getImageAlt(productName, productSku, categoryName, index)}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover object-center"
                    loading="lazy"
                    unoptimized
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Image with Hover Zoom */}
      <div className="w-full aspect-w-1 aspect-h-1">
        <div 
          ref={imageRef}
          className="relative h-96 sm:h-[500px] bg-white rounded-lg overflow-hidden cursor-zoom-in"
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <Image
            src={currentImage}
            alt={getImageAlt(productName, productSku, categoryName, selectedImageIndex)}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 50vw"
            className="object-cover object-center transition-transform duration-200"
            style={{
              transform: isHovering ? 'scale(2)' : 'scale(1)',
              transformOrigin: `${mousePosition.x}% ${mousePosition.y}%`
            }}
            priority
            unoptimized
          />
          
          {/* Image Navigation */}
          {images.length > 1 && (
            <>
              <button
                onClick={() => handleImageChange('prev')}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 shadow-lg transition-opacity duration-200 hover:opacity-100"
              >
                <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
              </button>
              <button
                onClick={() => handleImageChange('next')}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 shadow-lg transition-opacity duration-200 hover:opacity-100"
              >
                <ChevronRightIcon className="h-5 w-5 text-gray-600" />
              </button>
            </>
          )}

          {/* Zoom Indicator */}
          {isHovering && (
            <div className="absolute top-4 right-4 bg-black/70 text-white px-2 py-1 rounded text-sm">
              Zoom: 2x
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
