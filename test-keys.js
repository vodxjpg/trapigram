// test-keys.js
const jwt = require("jsonwebtoken");

const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDHN5ehuQYZAjdX
J3CtoM+mNSkIGU8PFVlLw31NWFrILBWm2wRoanaj4Y8qtdP6NGbc1ppNnQRt34bN
P7+4/UfMmNM+fkVJ+SB9UWdTsGxj9+ohIPBMfSfT4+1aB3n6PbX/NNvaBp/7U6HM
+S+CpQqb6jWJxuc8JzTSyUAaiYso0PrhhKoWJvTYB3kVs7+5Lw9yStHBGMmOHv4M
RkpsK/ScexTST9Stoy1kMEPn66tI0FuV98u+WHrLmdtghzefycP44YXpPWrtQH+v
Q0WLz6vQ0rS+sO4L+ZY5TpOQzB41oD7EebkhtQRlRlVkeXrub+QBYOi7fT8gHe58
PfC8iIbrAgMBAAECggEAEhjlP+5AdQ4j+9lb3ZIBuw4SO6ec7Hhag8zu+ZNAr/V9
RAqaZGfjfjCz4kPhTVXsUDx4iPtuFxMaulODtajgmF/7tK4g2j706h12fv5EYnJ3
hOnqmnA2KYQHoEmUlZx8h4IERNKcPucSiD3MyJf4lkBY+7qjb+352PoqRh7fkuX8
DffFNDwFX+95qpZ9TfQlMqeNn62vzwNkFfIqgtHpqoj5tKncefE/CbGjCxwZu2h6
0oaYdTjnjGmzxzCC9pB8ENSGdHFLiKcqViOAe68ccXB+pxSRINhUAoA3lBc5hcCA
SuzfdrLW+Nb5mKUnDDP2ieezcdWqCcKF486x4edBcQKBgQDqDWt8zb3iCP6u+ghD
zshzu7EJLuKcaDQzdwSVvwiuirIlubTf0Eum94d0rTKLS0e1yPqh1J0P0JOoX1SH
SBEDKg4LcSX+krsMFHYQnTqYtcHIlbmEqU16v88GsXOyj9e73z4mmry+CgmNd4qi
2yMKQocZ/eut+l5mOR9Egg53OwKBgQDZ5e3pXUF3QibMjm4QNApS7Ev8Ezgyqj2l
3jz6RbRrp1Uf9aS7o+JqaZ7SxCqLRlhTzLaD+/LPx7xstxjA2fL9rqiCXGkJwcxs
Y54+4OH++sadXAT4Gx9PcoXCpvAejLwamjDTwUlCAXS0gYIsypu+ucm7aRcx12ZS
kAWCeKYUEQKBgQDGNuNG6L7cxJ1b9mg1dNQSH2xIyKolp6I9y5fYcdaaat+AT4u8
2ByZpJvU1jEuAm0SqMiJcRQqpovGViWyA/hUY7NNQV/Z/s3l5xYt79oGJjec9iAN
F4yEXhioJHRFTsh3VRK/guBBWSLJ6elBDrDYKYtdGcwUpSp5C/tM+4/grQKBgQDI
aN8SFTCiNJik6Zc3lfWs4SLd/PtiNgwvY6En+zZ/EU+M7oyN/KTBhNWMOtp6cL/K
i22PJQrlqmqWfyzoK01/n8Xi6IW/cJzJUDJ62LFjqFlG4By96Yw5sTZvmsUdBAn6
Wbjw+kSbzeT+JGOLOOpYWF6/3V90+w1kgIxgvQDbUQKBgCuFFZ9BIEuJ8qQgi7Zt
abiwHufdQG/F61O0Mr/GiCPf2o+4x//ZAzGQVk9CIm5xAcT8uW1zdH0LMIi+V5hE
NCFARePMIQ0A2D/NHy2ORS1B1AsiKmNpRnzvGtb1UTdGCkawsf71XzuQt52LnQXh
172Hh/evZuG7n9scwtpygk0v
-----END PRIVATE KEY-----`;
const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxzeXobkGGQI3VydwraDP
pjUpCBlPDxVZS8N9TVhayCwVptsEaGp2o+GPKrXT+jRm3NaaTZ0Ebd+GzT+/uP1H
zJjTPn5FSfkgfVFnU7BsY/fqISDwTH0n0+PtWgd5+j21/zTb2gaf+1OhzPkvgqUK
m+o1icbnPCc00slAGomLKND64YSqFib02Ad5FbO/uS8PckrRwRjJjh7+DEZKbCv0
nHsU0k/UraMtZDBD5+urSNBblffLvlh6y5nbYIc3n8nD+OGF6T1q7UB/r0NFi8+r
0NK0vrDuC/mWOU6TkMweNaA+xHm5IbUEZUZVZHl67m/kAWDou30/IB3ufD3wvIiG
6wIDAQAB
-----END PUBLIC KEY-----`;

const payload = {
  sub: "service-account",
  scope: "full",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

try {
  const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });
  console.log("Generated JWT:", token);
  const verified = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
  console.log("Verified payload:", verified);
} catch (e) {
  console.error("Error:", e.message);
}

console.log("Public key format check:", publicKey.includes("-----BEGIN PUBLIC KEY-----"));
console.log("Private key format check:", privateKey.includes("-----BEGIN PRIVATE KEY-----"));