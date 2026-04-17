package crypto

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "crypto/rsa"
    "crypto/sha256"
    "crypto/x509"
    "encoding/base64"
    "encoding/pem"
    "errors"
)

type E2EEService struct{}

func NewE2EEService() *E2EEService {
    return &E2EEService{}
}

// GenerateRSAKeyPair generates RSA key pair for E2EE
func (s *E2EEService) GenerateRSAKeyPair() (privateKeyPEM, publicKeyPEM string, err error) {
    privateKey, err := rsa.GenerateKey(rand.Reader, 4096)
    if err != nil {
        return "", "", err
    }
    
    // Encode private key
    privateKeyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
    privateKeyPEM = string(pem.EncodeToMemory(&pem.Block{
        Type:  "RSA PRIVATE KEY",
        Bytes: privateKeyBytes,
    }))
    
    // Encode public key
    publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
    if err != nil {
        return "", "", err
    }
    publicKeyPEM = string(pem.EncodeToMemory(&pem.Block{
        Type:  "RSA PUBLIC KEY",
        Bytes: publicKeyBytes,
    }))
    
    return privateKeyPEM, publicKeyPEM, nil
}

// EncryptMessage encrypts a message with recipient's public key
func (s *E2EEService) EncryptMessage(message string, recipientPublicKeyPEM string) (encryptedContent, iv, encryptedKey string, err error) {
    // Generate AES key
    aesKey := make([]byte, 32) // AES-256
    if _, err := rand.Read(aesKey); err != nil {
        return "", "", "", err
    }
    
    // Generate IV
    ivBytes := make([]byte, 12) // GCM standard nonce size
    if _, err := rand.Read(ivBytes); err != nil {
        return "", "", "", err
    }
    
    // Encrypt message with AES-GCM
    block, err := aes.NewCipher(aesKey)
    if err != nil {
        return "", "", "", err
    }
    
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", "", "", err
    }
    
    ciphertext := gcm.Seal(nil, ivBytes, []byte(message), nil)
    
    // Encrypt AES key with recipient's RSA public key
    blockPub, _ := pem.Decode([]byte(recipientPublicKeyPEM))
    if blockPub == nil {
        return "", "", "", errors.New("failed to parse public key")
    }
    
    pub, err := x509.ParsePKIXPublicKey(blockPub.Bytes)
    if err != nil {
        return "", "", "", err
    }
    
    rsaPub, ok := pub.(*rsa.PublicKey)
    if !ok {
        return "", "", "", errors.New("invalid public key type")
    }
    
    encryptedAESKey, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, rsaPub, aesKey, nil)
    if err != nil {
        return "", "", "", err
    }
    
    return base64.StdEncoding.EncodeToString(ciphertext),
           base64.StdEncoding.EncodeToString(ivBytes),
           base64.StdEncoding.EncodeToString(encryptedAESKey),
           nil
}

// DecryptMessage decrypts a message with recipient's private key
func (s *E2EEService) DecryptMessage(encryptedContent, iv, encryptedKey, privateKeyPEM string) (string, error) {
    // Decode
    ciphertext, err := base64.StdEncoding.DecodeString(encryptedContent)
    if err != nil {
        return "", err
    }
    
    ivBytes, err := base64.StdEncoding.DecodeString(iv)
    if err != nil {
        return "", err
    }
    
    encryptedAESKey, err := base64.StdEncoding.DecodeString(encryptedKey)
    if err != nil {
        return "", err
    }
    
    // Parse private key
    blockPriv, _ := pem.Decode([]byte(privateKeyPEM))
    if blockPriv == nil {
        return "", errors.New("failed to parse private key")
    }
    
    priv, err := x509.ParsePKCS1PrivateKey(blockPriv.Bytes)
    if err != nil {
        return "", err
    }
    
    // Decrypt AES key with RSA private key
    aesKey, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, priv, encryptedAESKey, nil)
    if err != nil {
        return "", err
    }
    
    // Decrypt message with AES-GCM
    block, err := aes.NewCipher(aesKey)
    if err != nil {
        return "", err
    }
    
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }
    
    plaintext, err := gcm.Open(nil, ivBytes, ciphertext, nil)
    if err != nil {
        return "", err
    }
    
    return string(plaintext), nil
}

// GenerateEphemeralKeyPair generates ephemeral keys for call encryption
func (s *E2EEService) GenerateEphemeralKeyPair() (privateKey, publicKey []byte, err error) {
    privateKey, err = GenerateX25519Key()
    if err != nil {
        return nil, nil, err
    }
    publicKey = DerivePublicKey(privateKey)
    return privateKey, publicKey, nil
}

func GenerateX25519Key() ([]byte, error) {
    key := make([]byte, 32)
    _, err := rand.Read(key)
    return key, err
}

func DerivePublicKey(privateKey []byte) []byte {
    // Simplified - in production use proper X25519
    return privateKey
}