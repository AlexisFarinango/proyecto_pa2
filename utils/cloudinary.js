const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const axios = require('axios');

const configure = (opts) => {
  cloudinary.config({
    cloud_name: opts.cloud_name,
    api_key: opts.api_key,
    api_secret: opts.api_secret,
    secure: true
  });
};

const uploadBuffer = (buffer, filename, resourceType = 'image', folder = 'Futbol') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename,
        resource_type: resourceType, // 👈 Aquí la magia
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};


// Separa una URL de Cloudinary en sus partes (cloud, tipo de recurso, public_id, extensión)
const parseCloudinaryUrl = (url) => {
  try {
    const u = new URL(url);
    if (u.hostname !== 'res.cloudinary.com') return null;
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [cloud, resourceType, type, ...resto] = parts;
    if (!cloud || !resourceType || !type || !resto.length) return null;
    if (/^v\d+$/.test(resto[0])) resto.shift();
    const publicIdConExt = resto.join('/');
    const m = publicIdConExt.match(/^(.*)\.([a-z0-9]+)$/i);
    return {
      cloud,
      resourceType,
      type,
      publicIdConExt,
      publicId: m ? m[1] : publicIdConExt,
      ext: m ? m[2].toLowerCase() : '',
    };
  } catch {
    return null;
  }
};

/**
 * Descarga un archivo de Cloudinary. Cloudinary bloquea por defecto la entrega pública de
 * archivos .pdf (HTTP 401); en ese caso se descarga con la API autenticada.
 */
const descargarArchivo = async (url) => {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000, validateStatus: () => true });
  if (resp.status >= 200 && resp.status < 300) {
    return { buffer: Buffer.from(resp.data), contentType: resp.headers['content-type'] || '' };
  }
  const info = parseCloudinaryUrl(url);
  if (!info || ![401, 403].includes(resp.status)) {
    throw new Error(`No se pudo descargar el archivo (HTTP ${resp.status})`);
  }
  // En "raw" la extensión es parte del public_id; en imágenes va como formato
  const firmado = info.resourceType === 'raw'
    ? cloudinary.utils.private_download_url(info.publicIdConExt, '', { resource_type: 'raw', type: info.type })
    : cloudinary.utils.private_download_url(info.publicId, info.ext, { resource_type: info.resourceType, type: info.type });
  const resp2 = await axios.get(firmado, { responseType: 'arraybuffer', timeout: 20000 });
  return { buffer: Buffer.from(resp2.data), contentType: resp2.headers['content-type'] || '' };
};

module.exports = { configure, uploadBuffer, parseCloudinaryUrl, descargarArchivo };
