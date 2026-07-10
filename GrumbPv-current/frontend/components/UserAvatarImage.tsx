"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { resolveUploadImageUrl } from "@/config/config";

type Props = {
    imageId?: string | null;
    width: number;
    height: number;
    className?: string;
    alt?: string;
};

/**
 * User profile image from escrow uploads; falls back to default.jpg on missing id or load error.
 */
export function UserAvatarImage({ imageId, width, height, className, alt = "User" }: Props) {
    const [src, setSrc] = useState(() => resolveUploadImageUrl(imageId));

    useEffect(() => {
        setSrc(resolveUploadImageUrl(imageId));
    }, [imageId]);

    return (
        <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            className={className}
            onError={() => setSrc(resolveUploadImageUrl(null))}
        />
    );
}
