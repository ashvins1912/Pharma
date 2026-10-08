/**
 * Customer / Person / PUID Service
 * Owns: Customer, Person, PUID, PersonRelationship, FamilyInvitation
 * Does NOT own: credentials, JWT sessions, medical prescriptions
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';

const INSECURE = /^(change-me|secret123|default-secret)$/i;

function generatePuid() {
  // Server-generated, opaque, not derived from PII
  return `PUID-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
}

const personSchema = new mongoose.Schema({
  puid: { type: String, required: true, unique: true, immutable: true },
  displayName: { type: String, required: true },
  dateOfBirth: { type: String, default: null },
  gender: { type: String, default: null },
  relationshipToOwner: { type: String, default: 'SELF' },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
  tenantId: { type: String, default: null, index: true },
  createdByUserId: { type: String, required: true, index: true }
}, { timestamps: true });

personSchema.index({ createdByUserId: 1, status: 1 });

const customerSchema = new mongoose.Schema({
  customerId: { type: String, required: true, unique: true, default: () => `cust-${crypto.randomUUID().slice(0, 8)}` },
  userId: { type: String, required: true, unique: true, index: true },
  selfPuid: { type: String, required: true, index: true },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  name: { type: String, default: 'Valued Customer' },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
}, { timestamps: true });

const relationshipSchema = new mongoose.Schema({
  ownerUserId: { type: String, required: true, index: true },
  ownerCustomerId: { type: String, required: true, index: true },
  personPuid: { type: String, required: true, index: true },
  relationship: { type: String, required: true },
  canManage: { type: Boolean, default: true },
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' }
}, { timestamps: true });

relationshipSchema.index({ ownerUserId: 1, personPuid: 1 }, { unique: true });

const invitationSchema = new mongoose.Schema({
  invitationId: { type: String, required: true, unique: true, default: () => `inv-${crypto.randomUUID().slice(0, 10)}` },
  invitedByUserId: { type: String, required: true },
  inviteeEmail: { type: String, required: true },
  personPuid: { type: String, required: true },
  relationship: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'], default: 'PENDING', index: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

const Person = mongoose.models.Person || mongoose.model('Person', personSchema, 'persons');
const CustomerProfile = mongoose.models.CustomerProfile || mongoose.model('CustomerProfile', customerSchema, 'customers');
const PersonRelationship = mongoose.models.PersonRelationship
  || mongoose.model('PersonRelationship', relationshipSchema, 'person_relationships');
const FamilyInvitation = mongoose.models.FamilyInvitation
  || mongoose.model('FamilyInvitation', invitationSchema, 'family_invitations');

function maskPuid(puid) {
  if (!puid || puid.length < 4) return 'PUID-••••';
  return `PUID-••••${puid.slice(-4)}`;
}

export class CustomerService {
  async ensureCustomerForUser(userId, { name, email, phone, tenantId } = {}) {
    if (!userId) throw Object.assign(new Error('userId required'), { statusCode: 401 });
    let customer = await CustomerProfile.findOne({ userId });
    if (customer) {
      const updates = {};
      if (name && name.trim() && name.trim() !== customer.name) updates.name = name.trim();
      if (email && email !== customer.email) updates.email = email;
      if (phone && phone !== customer.phone) updates.phone = phone;
      if (Object.keys(updates).length) {
        customer = await CustomerProfile.findOneAndUpdate({ userId }, { $set: updates }, { new: true });
      }

      await Person.updateOne(
        { puid: customer.selfPuid, createdByUserId: userId },
        { $set: {
          ...(name?.trim() ? { displayName: name.trim() } : {}),
          ...(tenantId ? { tenantId } : {})
        } }
      );

      await PersonRelationship.updateOne(
        { ownerUserId: userId, personPuid: customer.selfPuid },
        { $setOnInsert: {
          ownerUserId: userId,
          ownerCustomerId: customer.customerId,
          personPuid: customer.selfPuid,
          relationship: 'SELF',
          canManage: true
        } },
        { upsert: true }
      );
      return this._serializeCustomer(customer);
    }

    const puid = generatePuid();
    const person = await Person.create({
      puid,
      displayName: name || 'Self',
      relationshipToOwner: 'SELF',
      createdByUserId: userId,
      tenantId: tenantId || null
    });
    customer = await CustomerProfile.create({
      userId,
      selfPuid: person.puid,
      name: name || 'Valued Customer',
      email: email || '',
      phone: phone || ''
    });
    await PersonRelationship.create({
      ownerUserId: userId,
      ownerCustomerId: customer.customerId,
      personPuid: person.puid,
      relationship: 'SELF',
      canManage: true
    });
    return this._serializeCustomer(customer);
  }

  async createFamilyPerson(userId, { displayName, relationship, dateOfBirth, gender, tenantId }) {
    const customer = await CustomerProfile.findOne({ userId });
    if (!customer) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
    if (!displayName || !relationship) {
      throw Object.assign(new Error('displayName and relationship are required'), { statusCode: 400 });
    }
    const puid = generatePuid();
    const person = await Person.create({
      puid,
      displayName,
      relationshipToOwner: relationship,
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      createdByUserId: userId,
      tenantId: tenantId || null
    });
    await PersonRelationship.create({
      ownerUserId: userId,
      ownerCustomerId: customer.customerId,
      personPuid: person.puid,
      relationship,
      canManage: true
    });
    return this._serializePerson(person);
  }

  async updateFamilyPerson(userId, puid, updates = {}) {
    await this.assertUserCanAccessPuid(userId, puid);
    const allowed = {};
    if (updates.displayName != null) allowed.displayName = String(updates.displayName).trim();
    if (updates.relationship != null) {
      allowed.relationshipToOwner = String(updates.relationship).trim();
    }
    if (updates.dateOfBirth !== undefined) allowed.dateOfBirth = updates.dateOfBirth || null;
    if (updates.gender !== undefined) allowed.gender = updates.gender || null;
    if (allowed.displayName !== undefined && !allowed.displayName) {
      throw Object.assign(new Error('displayName is required'), { statusCode: 400 });
    }
    const person = await Person.findOneAndUpdate(
      { puid, createdByUserId: userId, status: 'ACTIVE' },
      { $set: allowed },
      { new: true }
    ).lean();
    if (!person) throw Object.assign(new Error('Relative not found'), { statusCode: 404 });
    return this._serializePerson(person);
  }

  async removeFamilyPerson(userId, puid) {
    await this.assertUserCanAccessPuid(userId, puid);
    const person = await Person.findOneAndUpdate(
      { puid, createdByUserId: userId, status: 'ACTIVE' },
      { $set: { status: 'INACTIVE' } },
      { new: true }
    ).lean();
    if (!person) throw Object.assign(new Error('Relative not found'), { statusCode: 404 });
    await PersonRelationship.updateOne(
      { ownerUserId: userId, personPuid: puid, status: 'ACTIVE' },
      { $set: { status: 'REVOKED' } }
    );
    return { puid, status: 'INACTIVE' };
  }

  async listManagedPersons(userId) {
    const rels = await PersonRelationship.find({ ownerUserId: userId, status: 'ACTIVE' }).lean();
    const puids = rels.map(r => r.personPuid);
    const people = await Person.find({ puid: { $in: puids }, status: 'ACTIVE' }).lean();
    return people.map(p => this._serializePerson(p));
  }

  async assertUserCanAccessPuid(userId, puid) {
    const rel = await PersonRelationship.findOne({ ownerUserId: userId, personPuid: puid, status: 'ACTIVE' });
    if (!rel) throw Object.assign(new Error('PUID access denied'), { statusCode: 403 });
    return true;
  }

  async createInvitation(userId, { inviteeEmail, personPuid, relationship, ttlHours = 72 }) {
    await this.assertUserCanAccessPuid(userId, personPuid);
    const invitation = await FamilyInvitation.create({
      invitedByUserId: userId,
      inviteeEmail,
      personPuid,
      relationship,
      expiresAt: new Date(Date.now() + ttlHours * 3600_000)
    });
    return invitation.toObject();
  }

  _serializeCustomer(customer) {
    return {
      customerId: customer.customerId,
      userId: customer.userId,
      selfPuid: customer.selfPuid,
      selfPuidMasked: maskPuid(customer.selfPuid),
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status
    };
  }

  _serializePerson(person) {
    return {
      puid: person.puid,
      puidMasked: maskPuid(person.puid),
      displayName: person.displayName,
      relationshipToOwner: person.relationshipToOwner,
      dateOfBirth: person.dateOfBirth,
      gender: person.gender,
      status: person.status
    };
  }
}

export const customerService = new CustomerService();
export { maskPuid, generatePuid, Person, CustomerProfile, PersonRelationship, FamilyInvitation, INSECURE };
